/** Plain-language explanations used in tooltips across the app. */
export const glossary = {
  estimatedSpend:
    'Calculated from measured tokens and illustrative demo rates. It is an estimate for showback, not an amount due.',
  tokens:
    'Tokens are the small chunks of text a model reads (input) and writes (output). Providers measure usage in tokens.',
  showback:
    'Showback explains which team used which AI services and what that is estimated to cost. It does not charge anyone.',
  reconciliation:
    'Reconciliation compares an estimate with the provider’s billing record. In this demo, reconciliation states are sample data only.',
  unresolved:
    'Requests whose usage was not reported, so no cost can be calculated. They are shown separately and never counted as $0.',
  averageCost:
    'Estimated spend divided by the number of requests that have a calculable cost. Unresolved requests are excluded.',
  teamCode:
    'Each team has one unique usage code attached to its requests, so costs map back to the right team.',
  illustrative:
    'Model names and rates in this workspace are illustrative sample values, not current provider pricing.',
} as const;
