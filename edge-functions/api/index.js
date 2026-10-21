import { createHandler } from '../_lib/compiler.js';
const handle = createHandler();
export function onRequest(context) {
    return handle(context.request, context.env || {});
}
export default onRequest;
