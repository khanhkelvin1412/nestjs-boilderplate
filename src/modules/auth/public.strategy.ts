import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

@Injectable()
export class PublicStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super();
  }

  authenticate(): void {
    return this.success({ [Symbol.for('isPublic')]: true });
  }
}
