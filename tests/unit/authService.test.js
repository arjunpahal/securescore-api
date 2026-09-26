'use strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

jest.mock('../../src/models/userModel');

const bcrypt = require('bcryptjs');
const userModel = require('../../src/models/userModel');
const authService = require('../../src/services/authService');
const { UnauthorizedError, ConflictError } = require('../../src/utils/errors');

describe('authService', () => {
  const PASSWORD = 'SecurePass2026';
  let passwordHash;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(() => jest.clearAllMocks());

  describe('register', () => {
    it('creates a user and returns a token', async () => {
      userModel.findByEmail.mockResolvedValue(null);
      userModel.create.mockResolvedValue({
        id: 'u1', email: 'new@deakin.edu.au', name: 'New User', role: 'developer'
      });

      const result = await authService.register({
        email: 'new@deakin.edu.au', name: 'New User', password: PASSWORD
      });

      expect(result.user.email).toBe('new@deakin.edu.au');
      expect(typeof result.token).toBe('string');
    });

    it('hashes the password before storing it', async () => {
      userModel.findByEmail.mockResolvedValue(null);
      userModel.create.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A', role: 'developer' });

      await authService.register({ email: 'a@b.com', name: 'A', password: PASSWORD });

      const storedHash = userModel.create.mock.calls[0][0].passwordHash;
      expect(storedHash).not.toBe(PASSWORD);
      expect(await bcrypt.compare(PASSWORD, storedHash)).toBe(true);
    });

    it('rejects a duplicate email with ConflictError', async () => {
      userModel.findByEmail.mockResolvedValue({ id: 'existing' });
      await expect(
        authService.register({ email: 'dup@deakin.edu.au', name: 'Dup', password: PASSWORD })
      ).rejects.toThrow(ConflictError);
    });

    it('defaults new accounts to the developer role', async () => {
      userModel.findByEmail.mockResolvedValue(null);
      userModel.create.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A', role: 'developer' });
      await authService.register({ email: 'a@b.com', name: 'A', password: PASSWORD });
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'developer' })
      );
    });
  });

  describe('login', () => {
    it('returns a user and token for correct credentials', async () => {
      userModel.findByEmail.mockResolvedValue({
        id: 'u1', email: 'a@b.com', name: 'A', role: 'admin', password_hash: passwordHash
      });

      const result = await authService.login({ email: 'a@b.com', password: PASSWORD });
      expect(result.user.id).toBe('u1');
      expect(typeof result.token).toBe('string');
    });

    it('never returns the password hash to the caller', async () => {
      userModel.findByEmail.mockResolvedValue({
        id: 'u1', email: 'a@b.com', name: 'A', role: 'admin', password_hash: passwordHash
      });
      const result = await authService.login({ email: 'a@b.com', password: PASSWORD });
      expect(result.user).not.toHaveProperty('password_hash');
    });

    it('rejects an unknown email', async () => {
      userModel.findByEmail.mockResolvedValue(null);
      await expect(
        authService.login({ email: 'nobody@b.com', password: PASSWORD })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('rejects an incorrect password', async () => {
      userModel.findByEmail.mockResolvedValue({
        id: 'u1', email: 'a@b.com', name: 'A', role: 'admin', password_hash: passwordHash
      });
      await expect(
        authService.login({ email: 'a@b.com', password: 'WrongPassword1' })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('returns an identical message for unknown email and wrong password', async () => {
      userModel.findByEmail.mockResolvedValueOnce(null);
      const unknownEmail = await authService.login({ email: 'x@b.com', password: PASSWORD })
        .catch((e) => e.message);

      userModel.findByEmail.mockResolvedValueOnce({
        id: 'u1', email: 'a@b.com', name: 'A', role: 'admin', password_hash: passwordHash
      });
      const wrongPassword = await authService.login({ email: 'a@b.com', password: 'Nope12345' })
        .catch((e) => e.message);

      // Identical messages prevent account enumeration
      expect(unknownEmail).toBe(wrongPassword);
    });
  });
});
