import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BrowserManager } from "./browser-manager.js";
import { BrowserRepository } from "./repository.js";
import {
  NavigationOptions,
  ScreenshotOptions,
  ExtractionOptions,
  ScrapingResult,
  SessionError,
  ExtractionError,
  NavigationError,
} from "./schema.js";
import { browserErrorHandler, BrowserError } from "./browser-error-handler.js";

export function setupBrowserTools(
  server: McpServer,
  browserManager: BrowserManager,
  repository: BrowserRepository
): void {
  // Navigation tool
  server.tool(
    "navigate",
    "Navigate to a URL in a browser session",
    {
      url: z.string().describe("The URL to navigate to"),
      sessionId: z
        .string()
        .optional()
        .describe(
          "Browser session ID (optional, will create new session if not provided)"
        ),
      viewport: z
        .object({
          width: z.number().default(1280),
          height: z.number().default(720),
        })
        .optional()
        .describe("Browser viewport size"),
      userAgent: z.string().optional().describe("Custom user agent string"),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle0", "networkidle2"])
        .default("networkidle2")
        .describe("When to consider navigation complete"),
      timeout: z
        .number()
        .default(60000)
        .describe("Navigation timeout in milliseconds"),
    },
    async (args: NavigationOptions) => {
      try {
        const sessionId =
          args.sessionId ||
          `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();

        // Create or get session
        const page = await browserManager.getOrCreateSession(sessionId, args);

        // Navigate if URL is different from current
        const currentUrl = page.url();
        if (currentUrl !== args.url) {
          await browserManager.navigateSession(sessionId, args);
        }

        const loadTime = Date.now() - startTime;
        const title = await page.title();
        const finalUrl = page.url();

        // Save navigation result
        const scrapingResult: ScrapingResult = {
          id: `nav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sessionId,
          url: finalUrl,
          timestamp: new Date(),
          data: {
            navigated: true,
            requestedUrl: args.url,
            finalUrl,
            title,
          },
          metadata: {
            title,
            loadTime,
            statusCode: 200,
          },
        };

        await repository.saveScrapingResult(scrapingResult);

        return {
          content: [
            {
              type: "text",
              text: `Successfully navigated to ${finalUrl}`,
            },
          ],
          success: true,
          sessionId,
          url: finalUrl,
          title,
          loadTime,
          message: `Successfully navigated to ${finalUrl}`,
        };
      } catch (error) {
        throw new NavigationError(
          `Navigation failed: ${error instanceof Error ? error.message : String(error)}`,
          args.url
        );
      }
    }
  );

  // Screenshot tool
  server.tool(
    "screenshot",
    "Take a screenshot of the current page or specific element",
    {
      sessionId: z.string().optional().describe("Browser session ID"),
      url: z
        .string()
        .optional()
        .describe(
          "URL to navigate to before taking screenshot (optional if sessionId provided)"
        ),
      selector: z
        .string()
        .optional()
        .describe("CSS selector for specific element screenshot"),
      fullPage: z
        .boolean()
        .default(false)
        .describe("Take full page screenshot"),
      format: z
        .enum(["png", "jpeg", "webp"])
        .default("png")
        .describe("Screenshot format"),
      quality: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Screenshot quality (for jpeg/webp)"),
      width: z.number().optional().describe("Screenshot width"),
      height: z.number().optional().describe("Screenshot height"),
      waitForSelector: z
        .string()
        .optional()
        .describe(
          "Wait for this CSS selector to be visible before taking screenshot"
        ),
      waitDelay: z
        .number()
        .default(2000)
        .describe(
          "Additional delay in milliseconds before taking screenshot (for dynamic content)"
        ),
      timeout: z
        .number()
        .default(60000)
        .describe("Operation timeout in milliseconds"),
    },
    async (args: ScreenshotOptions) => {
      return await browserErrorHandler.executeWithRetry(
        async () => {
          let page;
          let sessionId = args.sessionId;
          let isTemporarySession = false;

          if (args.url && !sessionId) {
            sessionId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            isTemporarySession = true;
            page = await browserManager.createSession(sessionId, {
              url: args.url,
              viewport:
                args.width && args.height
                  ? { width: args.width, height: args.height }
                  : undefined,
              timeout: 90000,
            });
          } else if (sessionId) {
            page = await browserManager.getSession(sessionId);
            if (!page) {
              throw new SessionError(
                `Session ${sessionId} not found`,
                sessionId
              );
            }
            if (args.url) {
              await browserManager.navigateSession(sessionId, {
                url: args.url,
              });
            }
          } else {
            throw new Error("Either sessionId or url must be provided");
          }

          // Wait for specific selector if provided
          if (args.waitForSelector) {
            try {
              await page.waitForSelector(args.waitForSelector, {
                timeout: 10000,
              });
              console.log(`✅ Found selector: ${args.waitForSelector}`);
            } catch (error) {
              console.log(
                `⚠️  Selector not found: ${args.waitForSelector}, continuing anyway`
              );
            }
          }

          // Wait additional time for dynamic content to load (especially for JavaScript-heavy pages like clocks)
          const waitDelay = args.waitDelay ?? 2000; // Default 2 seconds
          if (waitDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitDelay));
          }

          // Take screenshot
          const screenshotOptions: any = {
            type: args.format || "png",
            fullPage: args.fullPage || false,
            encoding: "base64",
          };

          if (
            args.quality &&
            (args.format === "jpeg" || args.format === "webp")
          ) {
            screenshotOptions.quality = args.quality;
          }

          let screenshot: string;
          if (args.selector) {
            const element = await page.$(args.selector);
            if (!element) {
              throw new ExtractionError(
                `Element not found: ${args.selector}`,
                args.selector
              );
            }
            screenshot = (await element.screenshot(
              screenshotOptions
            )) as string;
          } else {
            screenshot = (await page.screenshot(screenshotOptions)) as string;
          }

          const title = await page.title();
          const currentUrl = page.url();

          // Save screenshot result
          const scrapingResult: ScrapingResult = {
            id: `screenshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sessionId,
            url: currentUrl,
            timestamp: new Date(),
            data: {
              screenshot: true,
              format: args.format || "png",
              fullPage: args.fullPage || false,
              selector: args.selector,
            },
            metadata: {
              title,
              loadTime: 0,
              statusCode: 200,
              screenshot: `data:image/${args.format || "png"};base64,${screenshot}`,
            },
          };

          await repository.saveScrapingResult(scrapingResult);

          // Create HTML image for immediate viewing
          const imageDataUrl = `data:image/${args.format || "png"};base64,${screenshot}`;
          const imageHtml = `<div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin: 10px 0; background: #f9f9f9;">
            <h3 style="margin-top: 0; color: #333;">📸 Screenshot from ${currentUrl}</h3>
            <img src="${imageDataUrl}" style="max-width: 100%; height: auto; border: 1px solid #ccc; border-radius: 4px;" alt="Screenshot" />
            <div style="margin-top: 8px; font-size: 12px; color: #666;">
              <strong>Format:</strong> ${args.format || "png"} | 
              <strong>Size:</strong> ${Math.round(screenshot.length / 1024)}KB | 
              <strong>Full page:</strong> ${args.fullPage ? "Yes" : "No"}
              ${args.selector ? ` | <strong>Element:</strong> ${args.selector}` : ""}
            </div>
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer; color: #007acc;">📋 Copy Base64 Data</summary>
              <textarea readonly style="width: 100%; height: 100px; margin-top: 5px; font-family: monospace; font-size: 10px; resize: vertical;">${imageDataUrl}</textarea>
              <div style="font-size: 11px; color: #888; margin-top: 4px;">💡 Tip: Copy this data and paste it into any base64 decoder or save as an HTML file to view</div>
            </details>
          </div>`;

          return {
            content: [
              {
                type: "text",
                text: imageHtml,
              },
            ],
            success: true,
            sessionId,
            url: currentUrl,
            screenshot_display: imageHtml,
            screenshot_data: imageDataUrl,
            screenshot_base64: screenshot,
            format: args.format || "png",
            size: screenshot.length,
            dimensions:
              args.width && args.height
                ? `${args.width}x${args.height}`
                : "auto",
            message: "Screenshot captured successfully - view image above!",
          };
        },
        {
          operation: "screenshot",
          sessionId: args.sessionId,
          url: args.url,
        },
        {
          maxRetries: 2, // Screenshots are expensive, so limit retries
          baseDelay: 2000,
          maxDelay: 8000,
        },
        // Cleanup function for temporary sessions
        async () => {
          if (args.sessionId && args.sessionId.startsWith("temp_")) {
            try {
              await browserManager.closeSession(args.sessionId);
            } catch (cleanupError) {
              console.warn(
                `Failed to cleanup temporary session ${args.sessionId}:`,
                cleanupError
              );
            }
          }
        }
      );
    }
  );

  // Extract text tool
  server.tool(
    "extract_text",
    "Extract text content from the page using CSS selectors",
    {
      sessionId: z.string().optional().describe("Browser session ID"),
      url: z
        .string()
        .optional()
        .describe(
          "URL to navigate to before extraction (optional if sessionId provided)"
        ),
      selectors: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Object with keys as field names and values as CSS selectors"
        ),
      selector: z
        .string()
        .optional()
        .describe("Single CSS selector for simple extraction"),
      attribute: z
        .string()
        .optional()
        .describe("HTML attribute to extract (default: textContent)"),
      multiple: z
        .boolean()
        .default(false)
        .describe("Extract multiple elements matching the selector"),
      waitForSelector: z
        .string()
        .optional()
        .describe("Wait for this selector before extraction"),
      timeout: z
        .number()
        .default(5000)
        .describe("Timeout for waiting for selectors"),
    },
    async (args: ExtractionOptions) => {
      try {
        let page;
        let sessionId = args.sessionId;

        if (args.url && !sessionId) {
          sessionId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          page = await browserManager.createSession(sessionId, {
            url: args.url,
            timeout: 90000,
          });
        } else if (sessionId) {
          page = await browserManager.getSession(sessionId);
          if (!page) {
            throw new SessionError(`Session ${sessionId} not found`, sessionId);
          }
          if (args.url) {
            await browserManager.navigateSession(sessionId, { url: args.url });
          }
        } else {
          throw new Error("Either sessionId or url must be provided");
        }

        // Wait for selector if specified
        if (args.waitForSelector) {
          await page.waitForSelector(args.waitForSelector, {
            timeout: args.timeout,
          });
        }

        let extractedData: any = {};
        const currentUrl = page.url();
        const title = await page.title();

        if (args.selectors) {
          // Extract multiple fields
          for (const [fieldName, selector] of Object.entries(args.selectors)) {
            try {
              if (args.multiple) {
                extractedData[fieldName] = await page.$$eval(
                  selector,
                  (elements, attr) =>
                    elements
                      .map((el) =>
                        attr ? el.getAttribute(attr) : el.textContent?.trim()
                      )
                      .filter(Boolean),
                  args.attribute
                );
              } else {
                extractedData[fieldName] = await page.$eval(
                  selector,
                  (element, attr) =>
                    attr
                      ? element.getAttribute(attr)
                      : element.textContent?.trim(),
                  args.attribute
                );
              }
            } catch (error) {
              console.warn(
                `Failed to extract ${fieldName} with selector ${selector}:`,
                error
              );
              extractedData[fieldName] = null;
            }
          }
        } else if (args.selector) {
          // Extract single field
          try {
            if (args.multiple) {
              extractedData = await page.$$eval(
                args.selector,
                (elements, attr) =>
                  elements
                    .map((el) =>
                      attr ? el.getAttribute(attr) : el.textContent?.trim()
                    )
                    .filter(Boolean),
                args.attribute
              );
            } else {
              extractedData = await page.$eval(
                args.selector,
                (element, attr) =>
                  attr
                    ? element.getAttribute(attr)
                    : element.textContent?.trim(),
                args.attribute
              );
            }
          } catch (error) {
            throw new ExtractionError(
              `Failed to extract with selector ${args.selector}`,
              args.selector
            );
          }
        } else {
          // Extract full page text
          extractedData = await page.evaluate((): string | undefined => {
            // @ts-ignore - document is available in browser context
            return document.body.textContent?.trim();
          });
        }

        // Save extraction result
        const scrapingResult: ScrapingResult = {
          id: `extract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sessionId,
          url: currentUrl,
          timestamp: new Date(),
          data: extractedData,
          metadata: {
            title,
            loadTime: 0,
            statusCode: 200,
          },
        };

        await repository.saveScrapingResult(scrapingResult);

        // Create formatted display of extracted text
        const createTextDisplay = (
          data: any,
          selectors?: Record<string, string>
        ) => {
          if (typeof data === "string") {
            // Single string extraction
            return `<div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; background: #f9f9f9;">
              <h3 style="margin-top: 0; color: #333;">📝 Extracted Text from ${currentUrl}</h3>
              <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; max-height: 300px; overflow-y: auto;">
                <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.4;">${data}</pre>
              </div>
              <div style="margin-top: 8px; font-size: 12px; color: #666;">
                <strong>Length:</strong> ${data.length} characters
              </div>
            </div>`;
          } else if (Array.isArray(data)) {
            // Array of extracted items
            return `<div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; background: #f9f9f9;">
              <h3 style="margin-top: 0; color: #333;">📝 Extracted Text Array from ${currentUrl}</h3>
              <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; max-height: 300px; overflow-y: auto;">
                ${data
                  .map(
                    (
                      item,
                      index
                    ) => `<div style="margin-bottom: 8px; padding: 6px; background: #f8f8f8; border-radius: 3px;">
                  <strong>[${index}]:</strong> ${typeof item === "string" ? item : JSON.stringify(item)}
                </div>`
                  )
                  .join("")}
              </div>
              <div style="margin-top: 8px; font-size: 12px; color: #666;">
                <strong>Items found:</strong> ${data.length}
              </div>
            </div>`;
          } else if (typeof data === "object" && data !== null) {
            // Object with multiple fields
            return `<div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; background: #f9f9f9;">
             <h3 style="margin-top: 0; color: #333;">📝 Extracted Fields from ${currentUrl}</h3>
             <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; max-height: 500px; overflow-y: auto;">
               ${Object.entries(data)
                 .map(([key, value]) => {
                   const selector = selectors?.[key] || "N/A";

                   if (Array.isArray(value)) {
                     // Enhanced array display with individual items
                     const previewItems = value.slice(0, 5);
                     const hasMore = value.length > 5;

                     return `<div style="margin-bottom: 15px; padding: 10px; background: #f8f8f8; border-radius: 4px; border-left: 4px solid #007acc;">
                     <div style="font-weight: bold; color: #333; margin-bottom: 6px; display: flex; align-items: center;">
                       <span>${key}</span>
                       <span style="background: #007acc; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px; margin-left: 8px;">${value.length}</span>
                     </div>
                     <div style="font-size: 11px; color: #666; margin-bottom: 8px;">Selector: <code>${selector}</code></div>
                     <div style="background: white; padding: 8px; border-radius: 3px; border: 1px solid #e0e0e0;">
                       ${previewItems
                         .map(
                           (item, index) =>
                             `<div style="padding: 4px 0; border-bottom: 1px solid #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.4;">
                           <span style="color: #666; font-size: 11px; margin-right: 8px;">[${index + 1}]</span>
                           <span>${String(item).length > 100 ? String(item).substring(0, 100) + "..." : String(item)}</span>
                         </div>`
                         )
                         .join("")}
                       ${hasMore ? `<div style="padding: 6px 0; color: #666; font-style: italic; text-align: center; font-size: 11px;">... and ${value.length - 5} more items</div>` : ""}
                     </div>
                     <details style="margin-top: 8px;">
                       <summary style="cursor: pointer; color: #007acc; font-size: 11px;">📋 View All ${value.length} Items</summary>
                       <div style="margin-top: 6px; max-height: 200px; overflow-y: auto; background: white; padding: 6px; border-radius: 3px; border: 1px solid #e0e0e0;">
                         ${value
                           .map(
                             (item, index) =>
                               `<div style="padding: 2px 0; font-size: 11px; font-family: monospace;">
                             <span style="color: #666;">[${index + 1}]</span> ${String(item)}
                           </div>`
                           )
                           .join("")}
                       </div>
                     </details>
                   </div>`;
                   } else {
                     // Single value display
                     const displayValue = String(value);
                     return `<div style="margin-bottom: 15px; padding: 10px; background: #f8f8f8; border-radius: 4px; border-left: 4px solid #28a745;">
                     <div style="font-weight: bold; color: #333; margin-bottom: 6px;">${key}</div>
                     <div style="font-size: 11px; color: #666; margin-bottom: 8px;">Selector: <code>${selector}</code></div>
                     <div style="background: white; padding: 8px; border-radius: 3px; border: 1px solid #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.4;">
                       ${displayValue.length > 200 ? displayValue.substring(0, 200) + "..." : displayValue}
                     </div>
                     ${
                       displayValue.length > 200
                         ? `
                       <details style="margin-top: 8px;">
                         <summary style="cursor: pointer; color: #007acc; font-size: 11px;">📋 View Full Content</summary>
                         <div style="margin-top: 6px; max-height: 200px; overflow-y: auto; background: white; padding: 6px; border-radius: 3px; border: 1px solid #e0e0e0; font-size: 11px; font-family: monospace; white-space: pre-wrap;">${displayValue}</div>
                       </details>
                     `
                         : ""
                     }
                   </div>`;
                   }
                 })
                 .join("")}
             </div>
             <div style="margin-top: 8px; font-size: 12px; color: #666;">
               <strong>Fields extracted:</strong> ${Object.keys(data).length} | 
               <strong>Total items:</strong> ${Object.values(data).reduce((sum: number, val) => sum + (Array.isArray(val) ? val.length : 1), 0)}
             </div>
           </div>`;
          }
          return "<div>No data extracted</div>";
        };

        const textDisplay = createTextDisplay(extractedData, args.selectors);

        return {
          content: [
            {
              type: "text",
              text: textDisplay,
            },
          ],
          success: true,
          sessionId,
          url: currentUrl,
          data: extractedData,
          text_display: textDisplay,
          extraction_summary: {
            fields:
              typeof extractedData === "object" && !Array.isArray(extractedData)
                ? Object.keys(extractedData).length
                : 1,
            total_length:
              typeof extractedData === "string"
                ? extractedData.length
                : Array.isArray(extractedData)
                  ? extractedData.length
                  : JSON.stringify(extractedData).length,
          },
          message: "Text extraction completed - view results above!",
        };
      } catch (error) {
        throw new ExtractionError(
          `Text extraction failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // Extract links tool
  server.tool(
    "extract_links",
    "Extract all links from the page with optional filtering",
    {
      sessionId: z.string().optional().describe("Browser session ID"),
      url: z
        .string()
        .optional()
        .describe(
          "URL to navigate to before extraction (optional if sessionId provided)"
        ),
      filter: z
        .string()
        .optional()
        .describe("Filter links by text content or href pattern"),
      internal: z
        .boolean()
        .optional()
        .describe("Only extract internal links (same domain)"),
      external: z
        .boolean()
        .optional()
        .describe("Only extract external links (different domain)"),
      timeout: z
        .number()
        .default(90000)
        .describe("Timeout in milliseconds for page operations"),
    },
    async (args: ExtractionOptions) => {
      try {
        let page;
        let sessionId = args.sessionId;

        if (args.url && !sessionId) {
          sessionId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          page = await browserManager.createSession(sessionId, {
            url: args.url,
            timeout: 90000,
          });
        } else if (sessionId) {
          page = await browserManager.getSession(sessionId);
          if (!page) {
            throw new SessionError(`Session ${sessionId} not found`, sessionId);
          }
          if (args.url) {
            await browserManager.navigateSession(sessionId, { url: args.url });
          }
        } else {
          throw new Error("Either sessionId or url must be provided");
        }

        const currentUrl = page.url();
        const currentDomain = new URL(currentUrl).hostname;
        const title = await page.title();

        // Extract all links
        const links = await page.evaluate(
          (
            filter: string | undefined,
            internal: boolean | undefined,
            external: boolean | undefined,
            currentDomain: string
          ) => {
            // @ts-ignore - document and window are available in browser context
            const linkElements = Array.from(
              document.querySelectorAll("a[href]")
            );

            return linkElements
              .map((link: any) => {
                const href = link.getAttribute("href");
                const text = link.textContent?.trim();

                if (!href) return null;

                let fullUrl: string;
                try {
                  // @ts-ignore - window is available in browser context
                  fullUrl = new URL(href, window.location.href).href;
                } catch {
                  return null;
                }

                const linkDomain = new URL(fullUrl).hostname;
                const isInternal = linkDomain === currentDomain;

                // Apply filters
                if (internal && !isInternal) return null;
                if (external && isInternal) return null;

                // Strict filter: only match if filter text is found in URL OR visible link text
                if (filter) {
                  const filterLower = filter.toLowerCase();
                  const urlMatch = fullUrl.toLowerCase().includes(filterLower);
                  const textMatch =
                    text && text.trim().toLowerCase().includes(filterLower);

                  // Only include if filter matches URL or visible text (not empty text)
                  if (!urlMatch && !textMatch) return null;
                }

                return {
                  url: fullUrl,
                  text: text || "",
                  internal: isInternal,
                  domain: linkDomain,
                };
              })
              .filter(Boolean);
          },
          args.filter,
          args.internal,
          args.external,
          currentDomain
        );

        // Save extraction result
        const scrapingResult: ScrapingResult = {
          id: `links_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sessionId,
          url: currentUrl,
          timestamp: new Date(),
          data: { links, count: links.length },
          metadata: {
            title,
            loadTime: 0,
            statusCode: 200,
          },
        };

        await repository.saveScrapingResult(scrapingResult);

        // Create formatted display for links
        const createLinksDisplay = (
          linksData: any[],
          filterText?: string,
          internal?: boolean,
          external?: boolean
        ) => {
          if (!linksData || linksData.length === 0) {
            return '<div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; background: #f9f9f9;"><h3 style="margin-top: 0; color: #333;">🔗 No Links Found</h3></div>';
          }

          const previewLinks = linksData.slice(0, 10);
          const hasMore = linksData.length > 10;

          // Group links by type
          const internalLinks = linksData.filter((link) => link.internal);
          const externalLinks = linksData.filter((link) => !link.internal);

          const filterInfo = [];
          if (filterText) filterInfo.push(`Filter: "${filterText}"`);
          if (internal) filterInfo.push("Internal only");
          if (external) filterInfo.push("External only");

          return `<div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; background: #f9f9f9;">
            <h3 style="margin-top: 0; color: #333;">🔗 Extracted Links from ${currentUrl}</h3>
            
            ${
              filterInfo.length > 0
                ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: #e3f2fd; border-radius: 4px; font-size: 12px; color: #1976d2;">
              <strong>Filters applied:</strong> ${filterInfo.join(" | ")}
            </div>`
                : ""
            }
            
            <div style="margin-bottom: 15px; display: flex; gap: 15px; font-size: 12px;">
              <span style="background: #28a745; color: white; padding: 4px 8px; border-radius: 12px;">
                <strong>Total:</strong> ${linksData.length}
              </span>
              <span style="background: #007acc; color: white; padding: 4px 8px; border-radius: 12px;">
                <strong>Internal:</strong> ${internalLinks.length}
              </span>
              <span style="background: #dc3545; color: white; padding: 4px 8px; border-radius: 12px;">
                <strong>External:</strong> ${externalLinks.length}
              </span>
            </div>
            
            <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; max-height: 400px; overflow-y: auto;">
              ${previewLinks
                .map((link, index) => {
                  const isInternal = link.internal;
                  const borderColor = isInternal ? "#28a745" : "#dc3545";
                  const typeLabel = isInternal ? "Internal" : "External";
                  const typeBg = isInternal ? "#d4edda" : "#f8d7da";
                  const typeColor = isInternal ? "#155724" : "#721c24";

                  return `<div style="margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid ${borderColor};">
                  <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <span style="background: ${typeBg}; color: ${typeColor}; padding: 2px 6px; border-radius: 10px; font-size: 10px; margin-right: 8px;">${typeLabel}</span>
                    <span style="color: #666; font-size: 11px;">[${index + 1}]</span>
                    ${link.domain ? `<span style="color: #666; font-size: 10px; margin-left: 8px;">${link.domain}</span>` : ""}
                  </div>
                  <div style="margin-bottom: 4px;">
                    <a href="${link.url}" target="_blank" style="color: #007acc; text-decoration: none; font-weight: 500; word-break: break-all;">${link.url}</a>
                  </div>
                  ${
                    link.text
                      ? `<div style="font-size: 11px; color: #666; font-style: italic;">
                    "${link.text.length > 80 ? link.text.substring(0, 80) + "..." : link.text}"
                  </div>`
                      : ""
                  }
                </div>`;
                })
                .join("")}
              
              ${
                hasMore
                  ? `<div style="padding: 10px; color: #666; font-style: italic; text-align: center; font-size: 11px; border-top: 1px solid #e0e0e0;">
                ... and ${linksData.length - 10} more links
              </div>`
                  : ""
              }
            </div>
            
            <details style="margin-top: 15px;">
              <summary style="cursor: pointer; color: #007acc; font-size: 12px; font-weight: 500;">📋 View All ${linksData.length} Links (Raw Data)</summary>
              <div style="margin-top: 8px; max-height: 300px; overflow-y: auto; background: white; padding: 8px; border-radius: 3px; border: 1px solid #e0e0e0;">
                ${linksData
                  .map(
                    (link, index) =>
                      `<div style="padding: 4px 0; font-size: 10px; font-family: monospace; border-bottom: 1px solid #f0f0f0;">
                    <span style="color: #666;">[${index + 1}]</span> 
                    <span style="color: ${link.internal ? "#28a745" : "#dc3545"};">${link.internal ? "INT" : "EXT"}</span> 
                    <a href="${link.url}" target="_blank" style="color: #007acc;">${link.url}</a>
                    ${link.text ? `<br><span style="color: #666; margin-left: 40px;">"${link.text}"</span>` : ""}
                  </div>`
                  )
                  .join("")}
              </div>
            </details>
            
            <div style="margin-top: 10px; font-size: 11px; color: #666;">
              💡 <strong>Tip:</strong> Click any link to open in a new tab, or use the raw data section for copying URLs
            </div>
          </div>`;
        };

        const linksDisplay = createLinksDisplay(
          links,
          args.filter,
          args.internal,
          args.external
        );

        return {
          content: [
            {
              type: "text",
              text: linksDisplay,
            },
          ],
          success: true,
          sessionId,
          url: currentUrl,
          links,
          count: links.length,
          links_display: linksDisplay,
          summary: {
            total: links.length,
            internal: links.filter((l) => l && l.internal).length,
            external: links.filter((l) => l && !l.internal).length,
            filtered: !!(args.filter || args.internal || args.external),
          },
          message: `Link extraction completed - found ${links.length} links!`,
        };
      } catch (error) {
        throw new ExtractionError(
          `Link extraction failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // Close session tool
  server.tool(
    "close_session",
    "Close a browser session",
    {
      sessionId: z.string().describe("Browser session ID to close"),
    },
    async (args: { sessionId: string }) => {
      try {
        await browserManager.closeSession(args.sessionId);

        return {
          content: [
            {
              type: "text",
              text: `Session ${args.sessionId} closed successfully`,
            },
          ],
          success: true,
          sessionId: args.sessionId,
          message: `Session ${args.sessionId} closed successfully`,
        };
      } catch (error) {
        throw new SessionError(
          `Failed to close session: ${error instanceof Error ? error.message : String(error)}`,
          args.sessionId
        );
      }
    }
  );
}
