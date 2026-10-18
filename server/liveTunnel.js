import { attachVoiceGateway } from "./voiceGateway.js";

/** Compatibility entrypoint for the upstream relay. The shared gateway preserves
 * planner sessions and lets Next's HMR handler own its upgrade namespace.
 */
export function attachLiveTunnel(server, options) {
  attachVoiceGateway(server, options);
  return server;
}
