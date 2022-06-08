import {IncomingMessage, ServerResponse} from "http";

export const port=Number(process.env.LAMBDA_PORT);
export const pingPath = '/ping';

export function pingHandler(req: IncomingMessage, res: ServerResponse):void {
    res.writeHead(204);
    res.end();
}
