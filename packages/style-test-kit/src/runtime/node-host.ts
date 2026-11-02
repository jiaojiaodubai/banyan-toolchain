/**
 * `createNodeHost()`: the factory that fixes the install order.
 *
 * Runtime and capabilities both exist before the host is returned, and the
 * factory installs the readiness gate (`assertHostCapabilities`) so a missing
 * capability is a named error when the style is created, instead of an obscure
 * `host-capability` failure halfway through a run.
 *
 * The gate reads `host.capabilities` on call, so a binding that fills
 * capabilities in later is still checked against what is actually there. Tests
 * that want to observe the core's *point-of-use* behavior pass
 * `assertCapabilities: false` to assemble a deliberately incomplete host.
 */
import {
  assertHostCapabilities,
  type StyleHost,
  type StyleHostCapabilities,
} from "../banyan";
import {
  createNodeSandboxRuntime,
  type NodeSandboxRuntimeOptions,
} from "./node-runtime";

export interface CreateNodeHostOptions extends NodeSandboxRuntimeOptions {
  /** Install the capability completeness gate. Default `true`. */
  assertCapabilities?: boolean;
}

export function createNodeHost(
  capabilities: Partial<StyleHostCapabilities> = {},
  options: CreateNodeHostOptions = {},
): StyleHost {
  const runtime = createNodeSandboxRuntime(options);
  const host: StyleHost = {
    runtime,
    capabilities: capabilities as StyleHostCapabilities,
  };
  if (options.assertCapabilities !== false) {
    host.assertReady = () => assertHostCapabilities(host.capabilities);
  }
  return host;
}
