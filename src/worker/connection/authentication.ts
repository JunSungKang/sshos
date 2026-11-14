import type { AgentAuthMethod, PasswordAuthMethod } from 'ssh2';

/** ssh2 accepts this synchronous authHandler return value, including false. */
export function oneShotAuthentication(method: PasswordAuthMethod | AgentAuthMethod) {
  let pending: PasswordAuthMethod | AgentAuthMethod | null = method;
  return (): PasswordAuthMethod | AgentAuthMethod | false => {
    if (pending === null) return false;
    const selected = pending;
    pending = null;
    return selected;
  };
}
