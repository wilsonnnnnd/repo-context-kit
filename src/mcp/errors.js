export function createJsonRpcError(code, message, data) {
    const error = {
        code,
        message,
    };

    if (data !== undefined) {
        error.data = data;
    }

    return error;
}

export function isJsonRpcRequest(value) {
    return (
        Boolean(value) &&
        typeof value === "object" &&
        value.jsonrpc === "2.0" &&
        typeof value.method === "string" &&
        (value.id === null || value.id === undefined || typeof value.id === "string" || typeof value.id === "number")
    );
}

