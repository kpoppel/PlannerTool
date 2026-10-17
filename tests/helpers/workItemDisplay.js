export function displayFixture(
  tiers = [['Epic'], ['Feature'], ['User Story', 'Bug'], ['Task']],
  categories = { New: 'Proposed', Active: 'InProgress', Closed: 'Completed' },
  sequence = Object.keys(categories),
) {
  return [{ process_id: 'process',
    tiers: tiers.map((tier) => tier.map((name) => ({ name,
      states: sequence.map((state) => ({ name: state,
        category: Object.hasOwn(categories, state) ? categories[state] : 'Proposed' })),
    }))),
  }];
}