export interface TestUser {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export function createUniqueTestUser(prefix = 'qa'): TestUser {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    firstName: 'QA',
    lastName: 'Automation',
    email: `${prefix}.${suffix}@test.com`,
    password: 'Password123!',
  };
}
