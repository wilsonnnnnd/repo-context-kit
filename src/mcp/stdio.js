import { TextDecoder } from "node:util";

const decoder = new TextDecoder("utf-8");

export function createStdioJsonRpcTransport({
    input = process.stdin,
    output = process.stdout,
} = {}) {
    let buffer = Buffer.alloc(0);

    function writeMessage(message) {
        const payload = Buffer.from(JSON.stringify(message), "utf-8");
        const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf-8");
        output.write(Buffer.concat([header, payload]));
    }

    function feed(chunk, onMessage) {
        buffer = Buffer.concat([buffer, chunk]);

        while (true) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) {
                return;
            }

            const headerBytes = buffer.slice(0, headerEnd);
            const headerText = decoder.decode(headerBytes);
            const lines = headerText.split("\r\n").filter(Boolean);
            let contentLength = null;

            for (const line of lines) {
                const match = line.match(/^Content-Length:\s*(\d+)\s*$/i);
                if (match) {
                    contentLength = Number.parseInt(match[1], 10);
                }
            }

            if (!Number.isFinite(contentLength) || contentLength < 0) {
                buffer = buffer.slice(headerEnd + 4);
                continue;
            }

            const messageStart = headerEnd + 4;
            const messageEnd = messageStart + contentLength;
            if (buffer.length < messageEnd) {
                return;
            }

            const jsonBytes = buffer.slice(messageStart, messageEnd);
            buffer = buffer.slice(messageEnd);

            let parsed;
            try {
                parsed = JSON.parse(decoder.decode(jsonBytes));
            } catch {
                continue;
            }

            onMessage(parsed);
        }
    }

    return {
        start(onMessage) {
            input.on("data", (chunk) => {
                feed(chunk, onMessage);
            });
        },
        send(message) {
            writeMessage(message);
        },
    };
}

