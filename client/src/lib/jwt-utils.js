import jwt from 'jsonwebtoken';

export const jwtSign = (payload, secret = 'agro-maint-secret-key-2026') => {
  return jwt.sign(payload, secret);
};