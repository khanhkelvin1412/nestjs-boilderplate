import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport';

@Injectable()
export class PublicStrategy extends PassportStrategy(Strategy, 'public') {
  constructor() {
    super();
  }

  // Passport local middleware will call to bypass authenticate
  authenticate(): void {
    return this.success({ [Symbol.for('isPublic')]: true });
  }
}
