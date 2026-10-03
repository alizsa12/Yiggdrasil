// Yggdrasil · agents
//
// The public surface of the agent subsystem. Import from here rather than from
// the individual modules:
//
//   import { AgentWorld, ModelDecider } from './agent/index.js';
//
// The modules are separate because they are separate concerns — world state,
// movement, perception, actions, memory, reasoning — but an application should
// not have to know that. See agent.js for the orchestrator and how a model's
// decisions turn into steps through a world.

export { AgentWorld, Agent } from './agent.js';
export { WorldState } from './world.js';
export { Movement, MOTION } from './movement.js';
export { Perception } from './perception.js';
export { ActionSet, ACTIONS } from './actions.js';
export { MemoryBridge, glance } from './memory.js';
export {
  ModelDecider, buildPacket, systemPrompt, userPrompt, parseDecision, extractText,
} from './reasoning.js';