import { afterEach, describe, expect, it, vi } from "vitest";
import {
	deriveCodeboxHttpBaseUrl,
	NullshotApiClient,
} from "./nullshot-api-client.js";

describe("NullshotApiClient", () => {
	it("should derive direct codebox HTTP hosts for known environments", () => {
		expect(deriveCodeboxHttpBaseUrl("http://localhost:3000")).toBe(
			"http://localhost:8888",
		);
		expect(
			deriveCodeboxHttpBaseUrl(
				"https://platform-website-pr-123.devaccounts-1password.workers.dev",
			),
		).toBe("https://playground-pr-123.devaccounts-1password.workers.dev");
		expect(deriveCodeboxHttpBaseUrl("https://test.nullshot.ai")).toBe(
			"https://test.xavalabs.com",
		);
		expect(deriveCodeboxHttpBaseUrl("https://nullshot.ai")).toBe(
			"https://instant.nullshot.dev",
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("should resolve jamId before fetching room messages", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						jams: [
							{
								id: "jam-123",
								name: "Demo Jam",
								slug: null,
								type: null,
								rooms: [
									{
										id: "room-456",
										jamId: "jam-123",
										title: "Task board",
										branchName: "main",
										state: null,
										type: null,
										previewUrl: "",
										codeboxId: null,
									},
								],
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						messages: [
							{
								id: "msg-1",
								ownerType: "user",
								content: "hello",
								timestamp: 1,
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const client = new NullshotApiClient({
			baseUrl: "http://localhost:3000",
			sessionToken: "token-123",
		});

		const messages = await client.getMessages("room-456");

		expect(messages).toHaveLength(1);
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"http://localhost:3000/api/jam/rooms",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer token-123",
				}),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"http://localhost:3000/api/jam/cli-messages?roomId=room-456&jamId=jam-123",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer token-123",
				}),
			}),
		);
	});

	it("should resolve jamId before fetching raw room messages", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						jams: [
							{
								id: "jam-abc",
								name: "Demo Jam",
								slug: null,
								type: null,
								rooms: [
									{
										id: "room-def",
										jamId: "jam-abc",
										title: "Dashboard",
										branchName: "main",
										state: null,
										type: null,
										previewUrl: "",
										codeboxId: null,
									},
								],
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(new Response("full transcript", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const client = new NullshotApiClient({
			baseUrl: "http://localhost:3000",
			sessionToken: "token-abc",
		});

		const transcript = await client.getRawMessages("room-def");

		expect(transcript).toBe("full transcript");
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"http://localhost:3000/api/jam/cli-messages-raw?roomId=room-def&jamId=jam-abc",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer token-abc",
				}),
			}),
		);
	});
});
