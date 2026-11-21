process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/schoolbus_test';
process.env.ROUTING = 'off';
