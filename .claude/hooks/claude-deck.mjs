#!/usr/bin/env node

import http from 'http';

// Configuration constants
const CLAUDEDECK_PORT = 17880;
const CLAUDEDECK_HOST = 'localhost';
const PROJECT_NAME = 'Claude';

// Read JSON input from stdin to get hook data
process.stdin.setEncoding('utf8');

let inputData = '';
for await (const chunk of process.stdin) {
  inputData += chunk;
}

try {
    const hookData = JSON.parse(inputData);
    const { session_id, hook_event_name } = hookData;
    
    const serviceId = session_id || PROJECT_NAME;
    
    console.log(`${hook_event_name || 'UNKNOWN'} HOOK`);
    
    // Route based on hook event type
    switch (hook_event_name) {
        case 'UserPromptSubmit':
        case 'PreToolUse': // resumes "running" after a permission prompt was approved
            await startClaudeDeckService(serviceId, PROJECT_NAME);
            break;

        case 'Notification': // Claude is waiting on user input
            await attentionClaudeDeckService(serviceId, PROJECT_NAME);
            break;

        case 'Stop':
            await finishClaudeDeckService(serviceId);
            break;

        default:
            console.log(`Unknown hook event: ${hook_event_name}`);
            break;
    }
} catch (error) {
    console.error('Hook parsing error:', error.message);
    process.exit(1);
}

// Call ClaudeDeck API to start service
async function startClaudeDeckService(sessionId, serviceName) {
    const postData = JSON.stringify({
        id: sessionId,
        name: serviceName
    });

    return makeHttpRequest('/start', postData, (response) => {
        console.log(`Started ClaudeDeck service "${serviceName}" - assigned: ${response.assignedContext}`);
    });
}

// Call ClaudeDeck API to mark the service as needing user attention
async function attentionClaudeDeckService(sessionId, serviceName) {
    const postData = JSON.stringify({
        id: sessionId,
        name: serviceName
    });

    return makeHttpRequest('/attention', postData, (response) => {
        console.log(`ClaudeDeck service "${serviceName}" needs attention - assigned: ${response.assignedContext}`);
    });
}

// Call ClaudeDeck API to finish the service
async function finishClaudeDeckService(sessionId) {
    const postData = JSON.stringify({
        id: sessionId,
        ok: true
    });

    return makeHttpRequest('/finish', postData, () => {
        console.log('ClaudeDeck service finished');
    });
}

// Shared HTTP request function
function makeHttpRequest(path, postData, onSuccess) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: CLAUDEDECK_HOST,
            port: CLAUDEDECK_PORT,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const response = JSON.parse(data);
                        onSuccess(response);
                        resolve(response);
                    } catch (e) {
                        onSuccess({});
                        resolve({});
                    }
                } else {
                    resolve({});
                }
            });
        });

        req.on('error', (e) => {
            // Silently fail if ClaudeDeck is not running
            resolve({});
        });

        req.write(postData);
        req.end();
    });
}
