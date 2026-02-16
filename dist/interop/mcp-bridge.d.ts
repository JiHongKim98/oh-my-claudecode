/**
 * MCP Bridge for Cross-Tool Interoperability
 *
 * Provides MCP tool definitions for communication between OMC and OMX.
 * Tools allow sending tasks and messages between the two systems.
 */
import { z } from 'zod';
import { ToolDefinition } from '../tools/types.js';
export declare const interopSendTaskTool: ToolDefinition<{
    target: z.ZodEnum<['omc', 'omx']>;
    type: z.ZodEnum<['analyze', 'implement', 'review', 'test', 'custom']>;
    description: z.ZodString;
    context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    files: z.ZodOptional<z.ZodArray<z.ZodString>>;
    workingDirectory: z.ZodOptional<z.ZodString>;
}>;
export declare const interopReadResultsTool: ToolDefinition<{
    source: z.ZodOptional<z.ZodEnum<['omc', 'omx']>>;
    status: z.ZodOptional<z.ZodEnum<['pending', 'in_progress', 'completed', 'failed']>>;
    limit: z.ZodOptional<z.ZodNumber>;
    workingDirectory: z.ZodOptional<z.ZodString>;
}>;
export declare const interopSendMessageTool: ToolDefinition<{
    target: z.ZodEnum<['omc', 'omx']>;
    content: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    workingDirectory: z.ZodOptional<z.ZodString>;
}>;
export declare const interopReadMessagesTool: ToolDefinition<{
    source: z.ZodOptional<z.ZodEnum<['omc', 'omx']>>;
    unreadOnly: z.ZodOptional<z.ZodBoolean>;
    limit: z.ZodOptional<z.ZodNumber>;
    markAsRead: z.ZodOptional<z.ZodBoolean>;
    workingDirectory: z.ZodOptional<z.ZodString>;
}>;
/**
 * Get all interop MCP tools for registration
 */
export declare function getInteropTools(): ToolDefinition<any>[];
//# sourceMappingURL=mcp-bridge.d.ts.map