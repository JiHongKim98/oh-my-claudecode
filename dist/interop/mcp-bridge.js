/**
 * MCP Bridge for Cross-Tool Interoperability
 *
 * Provides MCP tool definitions for communication between OMC and OMX.
 * Tools allow sending tasks and messages between the two systems.
 */
import { z } from 'zod';
import { addSharedTask, readSharedTasks, addSharedMessage, readSharedMessages, markMessageAsRead, } from './shared-state.js';
// ============================================================================
// interop_send_task - Send a task to the other tool
// ============================================================================
export const interopSendTaskTool = {
    name: 'interop_send_task',
    description: 'Send a task to the other tool (OMC -> OMX or OMX -> OMC) for execution. The task will be queued in shared state for the target tool to pick up.',
    schema: {
        target: z.enum(['omc', 'omx']).describe('Target tool to send the task to'),
        type: z.enum(['analyze', 'implement', 'review', 'test', 'custom']).describe('Type of task'),
        description: z.string().describe('Task description'),
        context: z.record(z.string(), z.unknown()).optional().describe('Additional context data'),
        files: z.array(z.string()).optional().describe('List of relevant file paths'),
        workingDirectory: z.string().optional().describe('Working directory (defaults to cwd)'),
    },
    handler: async (args) => {
        const { target, type, description, context, files, workingDirectory } = args;
        try {
            const cwd = workingDirectory || process.cwd();
            // Determine source (opposite of target)
            const source = target === 'omc' ? 'omx' : 'omc';
            const task = addSharedTask(cwd, {
                source,
                target,
                type,
                description,
                context,
                files,
            });
            return {
                content: [{
                        type: 'text',
                        text: `## Task Sent to ${target.toUpperCase()}\n\n` +
                            `**Task ID:** ${task.id}\n` +
                            `**Type:** ${task.type}\n` +
                            `**Description:** ${task.description}\n` +
                            `**Status:** ${task.status}\n` +
                            `**Created:** ${task.createdAt}\n\n` +
                            (task.files ? `**Files:** ${task.files.join(', ')}\n\n` : '') +
                            `The task has been queued for ${target.toUpperCase()} to pick up.`
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error sending task: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    }
};
// ============================================================================
// interop_read_results - Read task results from the other tool
// ============================================================================
export const interopReadResultsTool = {
    name: 'interop_read_results',
    description: 'Read task results from the shared interop state. Can filter by source tool and status.',
    schema: {
        source: z.enum(['omc', 'omx']).optional().describe('Filter by source tool'),
        status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional().describe('Filter by task status'),
        limit: z.number().optional().describe('Maximum number of tasks to return (default: 10)'),
        workingDirectory: z.string().optional().describe('Working directory (defaults to cwd)'),
    },
    handler: async (args) => {
        const { source, status, limit = 10, workingDirectory } = args;
        try {
            const cwd = workingDirectory || process.cwd();
            const tasks = readSharedTasks(cwd, {
                source: source,
                status: status,
            });
            const limitedTasks = tasks.slice(0, limit);
            if (limitedTasks.length === 0) {
                return {
                    content: [{
                            type: 'text',
                            text: '## No Tasks Found\n\nNo tasks match the specified filters.'
                        }]
                };
            }
            const lines = [
                `## Tasks (${limitedTasks.length}${tasks.length > limit ? ` of ${tasks.length}` : ''})\n`
            ];
            for (const task of limitedTasks) {
                const statusIcon = task.status === 'completed' ? '✓' :
                    task.status === 'failed' ? '✗' :
                        task.status === 'in_progress' ? '⋯' : '○';
                lines.push(`### ${statusIcon} ${task.id}`);
                lines.push(`- **Type:** ${task.type}`);
                lines.push(`- **Source:** ${task.source.toUpperCase()} → **Target:** ${task.target.toUpperCase()}`);
                lines.push(`- **Status:** ${task.status}`);
                lines.push(`- **Description:** ${task.description}`);
                lines.push(`- **Created:** ${task.createdAt}`);
                if (task.files && task.files.length > 0) {
                    lines.push(`- **Files:** ${task.files.join(', ')}`);
                }
                if (task.result) {
                    lines.push(`- **Result:** ${task.result.slice(0, 200)}${task.result.length > 200 ? '...' : ''}`);
                }
                if (task.error) {
                    lines.push(`- **Error:** ${task.error}`);
                }
                if (task.completedAt) {
                    lines.push(`- **Completed:** ${task.completedAt}`);
                }
                lines.push('');
            }
            return {
                content: [{
                        type: 'text',
                        text: lines.join('\n')
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error reading tasks: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    }
};
// ============================================================================
// interop_send_message - Send a message to the other tool
// ============================================================================
export const interopSendMessageTool = {
    name: 'interop_send_message',
    description: 'Send a message to the other tool for informational purposes or coordination.',
    schema: {
        target: z.enum(['omc', 'omx']).describe('Target tool to send the message to'),
        content: z.string().describe('Message content'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Additional metadata'),
        workingDirectory: z.string().optional().describe('Working directory (defaults to cwd)'),
    },
    handler: async (args) => {
        const { target, content, metadata, workingDirectory } = args;
        try {
            const cwd = workingDirectory || process.cwd();
            // Determine source (opposite of target)
            const source = target === 'omc' ? 'omx' : 'omc';
            const message = addSharedMessage(cwd, {
                source,
                target,
                content,
                metadata,
            });
            return {
                content: [{
                        type: 'text',
                        text: `## Message Sent to ${target.toUpperCase()}\n\n` +
                            `**Message ID:** ${message.id}\n` +
                            `**Content:** ${message.content}\n` +
                            `**Timestamp:** ${message.timestamp}\n\n` +
                            `The message has been queued for ${target.toUpperCase()}.`
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error sending message: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    }
};
// ============================================================================
// interop_read_messages - Read messages from the other tool
// ============================================================================
export const interopReadMessagesTool = {
    name: 'interop_read_messages',
    description: 'Read messages from the shared interop state. Can filter by source tool and read status.',
    schema: {
        source: z.enum(['omc', 'omx']).optional().describe('Filter by source tool'),
        unreadOnly: z.boolean().optional().describe('Show only unread messages (default: false)'),
        limit: z.number().optional().describe('Maximum number of messages to return (default: 10)'),
        markAsRead: z.boolean().optional().describe('Mark retrieved messages as read (default: false)'),
        workingDirectory: z.string().optional().describe('Working directory (defaults to cwd)'),
    },
    handler: async (args) => {
        const { source, unreadOnly = false, limit = 10, markAsRead = false, workingDirectory } = args;
        try {
            const cwd = workingDirectory || process.cwd();
            const messages = readSharedMessages(cwd, {
                source: source,
                unreadOnly,
            });
            const limitedMessages = messages.slice(0, limit);
            if (limitedMessages.length === 0) {
                return {
                    content: [{
                            type: 'text',
                            text: '## No Messages Found\n\nNo messages match the specified filters.'
                        }]
                };
            }
            // Mark messages as read if requested
            if (markAsRead) {
                for (const message of limitedMessages) {
                    markMessageAsRead(cwd, message.id);
                }
            }
            const lines = [
                `## Messages (${limitedMessages.length}${messages.length > limit ? ` of ${messages.length}` : ''})\n`
            ];
            for (const message of limitedMessages) {
                const readIcon = message.read ? '✓' : '○';
                lines.push(`### ${readIcon} ${message.id}`);
                lines.push(`- **From:** ${message.source.toUpperCase()} → **To:** ${message.target.toUpperCase()}`);
                lines.push(`- **Content:** ${message.content}`);
                lines.push(`- **Timestamp:** ${message.timestamp}`);
                lines.push(`- **Read:** ${message.read ? 'Yes' : 'No'}`);
                if (message.metadata) {
                    lines.push(`- **Metadata:** ${JSON.stringify(message.metadata)}`);
                }
                lines.push('');
            }
            if (markAsRead) {
                lines.push(`\n*${limitedMessages.length} message(s) marked as read*`);
            }
            return {
                content: [{
                        type: 'text',
                        text: lines.join('\n')
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error reading messages: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    }
};
/**
 * Get all interop MCP tools for registration
 */
export function getInteropTools() {
    return [
        interopSendTaskTool,
        interopReadResultsTool,
        interopSendMessageTool,
        interopReadMessagesTool,
    ];
}
//# sourceMappingURL=mcp-bridge.js.map