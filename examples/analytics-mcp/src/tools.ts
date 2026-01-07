import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AnalyticsRepository } from './repository';
import { z } from 'zod';
import {
  TrackMetricSchema,
  TrackBatchMetricsSchema,
  QueryAnalyticsSchema,
  GetMetricsSummarySchema,
  GetTimeSeriesSchema,
  AnalyzeTrendsSchema,
  ValidationError,
  AnalyticsError
} from './schema';

export function setupServerTools(server: McpServer, repository: AnalyticsRepository) {
  // Track metric tool
  server.tool(
    'track_metric',
    'Track a single analytics data point with dimensions and metrics',
    {
      dataset: z.string().describe('Dataset name to write to'),
      dimensions: z.record(z.string(), z.string()).describe('Categorical data for grouping'),
      metrics: z.record(z.string(), z.number()).describe('Numerical measurements'),
      timestamp: z.number().optional().describe('Unix timestamp (optional)')
    },
    async ({ dataset, dimensions, metrics, timestamp }: {
      dataset: string;
      dimensions: Record<string, string>;
      metrics: Record<string, number>;
      timestamp?: number;
    }) => {
      try {
        const validated = TrackMetricSchema.parse({ dataset, dimensions, metrics, timestamp });
        
        await repository.writeDataPoint(validated.dataset, {
          dimensions: validated.dimensions,
          metrics: validated.metrics,
          timestamp: validated.timestamp
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: {
                  message: `Successfully tracked metric in dataset '${validated.dataset}'`,
                  dataset: validated.dataset,
                  dimensions: Object.keys(validated.dimensions),
                  metrics: Object.keys(validated.metrics),
                  timestamp: validated.timestamp || Date.now()
                }
              })
            }
          ]
        };
      } catch (error) {
        console.error('trackMetric error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof ValidationError 
                  ? `Validation error: ${error.message}`
                  : error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );

  // Track batch metrics tool
  server.tool(
    'track_batch_metrics',
    'Track multiple analytics data points efficiently',
    {
      dataset: z.string().describe('Dataset name to write to'),
      dataPoints: z.array(z.object({
        dimensions: z.record(z.string(), z.string()),
        metrics: z.record(z.string(), z.number()),
        timestamp: z.number().optional(),
        metadata: z.record(z.string(), z.any()).optional()
      })).describe('Array of data points to track')
    },
    async ({ dataset, dataPoints }: {
      dataset: string;
      dataPoints: Array<{
        dimensions: Record<string, string>;
        metrics: Record<string, number>;
        timestamp?: number;
        metadata?: Record<string, any>;
      }>;
    }) => {
      try {
        const validated = TrackBatchMetricsSchema.parse({ dataset, dataPoints });
        
        await repository.writeDataPoints(validated.dataset, validated.dataPoints);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: {
                  message: `Successfully tracked ${validated.dataPoints.length} data points in dataset '${validated.dataset}'`,
                  dataset: validated.dataset,
                  count: validated.dataPoints.length,
                  timestamp: Date.now()
                }
              })
            }
          ]
        };
      } catch (error) {
        console.error('trackBatchMetrics error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof ValidationError 
                  ? `Validation error: ${error.message}`
                  : error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );

  // Query analytics tool
  server.tool(
    'query_analytics',
    'Execute SQL queries against analytics data',
    {
      sql: z.string().describe('SQL query to execute'),
      timeout: z.number().optional().describe('Query timeout in seconds (default: 30)')
    },
    async ({ sql, timeout }: {
      sql: string;
      timeout?: number;
    }) => {
      try {
        const validated = QueryAnalyticsSchema.parse({ sql, timeout });
        
        const result = await repository.query(validated.sql);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: result
              })
            }
          ]
        };
      } catch (error) {
        console.error('queryAnalytics error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof ValidationError 
                  ? `Validation error: ${error.message}`
                  : error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );

  // Get metrics summary tool
  server.tool(
    'get_metrics_summary',
    'Get aggregated metrics for a dataset',
    {
      dataset: z.string().describe('Dataset name to query'),
      timeRange: z.object({
        start: z.string().describe('Start time (ISO string)'),
        end: z.string().describe('End time (ISO string)')
      }).describe('Time range for the query'),
      dimensions: z.array(z.string()).optional().describe('Dimensions to group by')
    },
    async ({ dataset, timeRange, dimensions }: {
      dataset: string;
      timeRange: { start: string; end: string };
      dimensions?: string[];
    }) => {
      try {
        const validated = GetMetricsSummarySchema.parse({ dataset, timeRange, dimensions });
        
        const result = await repository.getMetrics(validated.dataset, {
          timeRange: validated.timeRange,
          dimensions: validated.dimensions
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: result
              })
            }
          ]
        };
      } catch (error) {
        console.error('getMetricsSummary error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof ValidationError 
                  ? `Validation error: ${error.message}`
                  : error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );

  // Get time series tool
  server.tool(
    'get_time_series',
    'Get time series data for a specific metric',
    {
      dataset: z.string().describe('Dataset name to query'),
      metric: z.string().describe('Metric name to analyze'),
      interval: z.enum(['1m', '5m', '15m', '1h', '1d']).describe('Time interval for aggregation'),
      timeRange: z.object({
        start: z.string().describe('Start time (ISO string)'),
        end: z.string().describe('End time (ISO string)')
      }).describe('Time range for the query'),
      dimensions: z.array(z.string()).optional().describe('Dimensions to filter by (event types)')
    },
    async ({ dataset, metric, interval, timeRange, dimensions }: {
      dataset: string;
      metric: string;
      interval: '1m' | '5m' | '15m' | '1h' | '1d';
      timeRange: { start: string; end: string };
      dimensions?: string[];
    }) => {
      try {
        const validated = GetTimeSeriesSchema.parse({ dataset, metric, interval, timeRange, dimensions });
        
        const result = await repository.getTimeSeries(validated.dataset, validated.metric, {
          interval: validated.interval,
          timeRange: validated.timeRange,
          dimensions: validated.dimensions
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: result
              })
            }
          ]
        };
      } catch (error) {
        console.error('getTimeSeries error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof ValidationError 
                  ? `Validation error: ${error.message}`
                  : error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );

  // Analyze trends tool
  server.tool(
    'analyze_trends',
    'Analyze trends in analytics data',
    {
      dataset: z.string().describe('Dataset name to analyze'),
      metric: z.string().describe('Metric to analyze for trends'),
      timeRange: z.enum(['1h', '24h', '7d', '30d']).describe('Time range'),
      column: z.string().optional().describe('Column to analyze (e.g., double1, double2, double3). Defaults to double1'),
    },
    async ({ dataset, metric, timeRange, column }: {
      dataset: string;
      metric: string;
      timeRange: '1h' | '24h' | '7d' | '30d';
      column?: string;
    }) => {
      try {
        const validated = AnalyzeTrendsSchema.parse({ dataset, metric, timeRange, column });
        
        // Simple trend analysis using basic SQL that Analytics Engine supports
        const result = await repository.analyzeTrends(validated.dataset, metric, validated.timeRange, column);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: result
              })
            }
          ]
        };
      } catch (error) {
        console.error('analyzeTrends error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof ValidationError 
                  ? `Validation error: ${error.message}`
                  : error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );

  // List datasets tool
  server.tool(
    'list_datasets',
    'List all available analytics datasets',
    {},
    async () => {
      try {
        const result = await repository.listDatasets();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: result
              })
            }
          ]
        };
      } catch (error) {
        console.error('listDatasets error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );

  // Get recent data tool
  server.tool(
    'get_recent_data',
    'Get recent data from a dataset for debugging and inspection',
    {
      dataset: z.string().describe('Dataset name to query'),
      limit: z.number().min(1).max(1000).optional().describe('Maximum number of records to return (default: 100)')
    },
    async ({ dataset, limit }: {
      dataset: string;
      limit?: number;
    }) => {
      try {
        const result = await repository.getRecentData(dataset, limit || 100);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: result
              })
            }
          ]
        };
      } catch (error) {
        console.error('getRecentData error:', error);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof AnalyticsError
                  ? `Analytics error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              })
            }
          ]
        };
      }
    }
  );
}