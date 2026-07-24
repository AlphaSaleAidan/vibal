// Proves an MCP tool call drives the shared VIBAL project. Spawns the server over stdio,
// lists tools, calls get_timeline + add_title, and prints the results.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: [new URL('./server.mjs', import.meta.url).pathname] });
const client = new Client({ name: 'test', version: '0.0.0' });
await client.connect(transport);
const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));
const before = await client.callTool({ name: 'get_timeline', arguments: {} });
console.log('\nGET_TIMELINE (before):\n' + before.content[0].text.split('\n').slice(0, 4).join('\n'));
const add = await client.callTool({ name: 'add_title', arguments: { text: 'Added by MCP agent', atSeconds: 4 } });
console.log('\nADD_TITLE:\n' + add.content[0].text);
const gen = await client.callTool({ name: 'add_generated_clip', arguments: { uri: 'https://example/gen.mp4', name: 'AI shot', model: 'seedance_2_0', prompt: 'neon alley' } });
console.log('\nADD_GENERATED_CLIP:\n' + gen.content[0].text);
await client.close();
