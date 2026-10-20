/**
 * Upgrade Analysis engine, shared with the AxiomFlo API so the demo workspace and the
 * real one calculate exactly the same way. The code lives in server/src/upgrade/ (the
 * API's container is built from server/ alone); see docs/agent/upgrade-analysis.md.
 */
export * from '../../server/src/upgrade/types';
export * from '../../server/src/upgrade/engine';
export * from '../../server/src/upgrade/report';
