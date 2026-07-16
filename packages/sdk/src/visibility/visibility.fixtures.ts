import type { Visibility } from './visibility';

// The ceiling rule of REQ-CTR-009: the level declared for a type is the MAXIMUM
// allowed exposure. Equal or better-protected passes; more exposed is rejected.
export const ceilingCases: {
  name: string;
  actual: Visibility;
  ceiling: Visibility;
  within: boolean;
}[] = [
  { name: 'public under a public ceiling', actual: 'public', ceiling: 'public', within: true },
  { name: 'organizer under a public ceiling', actual: 'organizer', ceiling: 'public', within: true },
  { name: 'module-private under a public ceiling', actual: 'module-private', ceiling: 'public', within: true },
  { name: 'public under an organizer ceiling', actual: 'public', ceiling: 'organizer', within: false },
  { name: 'organizer under an organizer ceiling', actual: 'organizer', ceiling: 'organizer', within: true },
  { name: 'module-private under an organizer ceiling', actual: 'module-private', ceiling: 'organizer', within: true },
  { name: 'public under a module-private ceiling', actual: 'public', ceiling: 'module-private', within: false },
  { name: 'organizer under a module-private ceiling', actual: 'organizer', ceiling: 'module-private', within: false },
  { name: 'module-private under a module-private ceiling', actual: 'module-private', ceiling: 'module-private', within: true },
];
