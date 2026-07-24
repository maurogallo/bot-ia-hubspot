module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  clearMocks: true,
  resetMocks: false,
  restoreMocks: false,
  collectCoverageFrom: [
    'src/domain/**/*.js',
    'src/adapters/**/*.js',
    '!src/adapters/inbound/whatsapp-adapter.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  transform: {},
};
