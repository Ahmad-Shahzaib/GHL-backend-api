import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  fullName: string;
  companyName: string;
  phone: string;
  desiredLocationName: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  locationId: string | null;
  companyId: string;
  plan: 'basic' | 'pro' | 'agency';
  status: 'pending' | 'active';
  isActive: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  passwordHash: string | null;
  passwordSetToken: string | null;
  passwordSetTokenExpiry: Date | null;
  passwordResetToken: string | null;
  passwordResetTokenExpiry: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email:               { type: String, required: true, unique: true, lowercase: true, trim: true },
    fullName:            { type: String, required: false, default: '', trim: true },
    companyName:         { type: String, required: false, default: '', trim: true },
    phone:               { type: String, required: false, default: '', trim: true },
    desiredLocationName: { type: String, required: false, default: '', trim: true },
    address:             { type: String, default: null },
    city:                { type: String, default: null },
    state:               { type: String, default: null },
    postalCode:          { type: String, default: null },
    country:             { type: String, default: null },
    locationId:          { type: String, default: null },
    companyId:           { type: String, default: 'K9bORvG0pKtvt7QO4R9B' },
    plan:                { type: String, enum: ['basic', 'pro', 'agency', 'full-intelligence', 'testing'], required: true },
    status:              { type: String, enum: ['pending', 'active'], default: 'pending' },
    isActive:            { type: Boolean, default: false },
    stripeCustomerId:    { type: String, default: null },
    stripeSubscriptionId:{ type: String, default: null },
    passwordHash:        { type: String, default: null },
    passwordSetToken:    { type: String, default: null },
    passwordSetTokenExpiry:  { type: Date, default: null },
    passwordResetToken:      { type: String, default: null },
    passwordResetTokenExpiry:{ type: Date, default: null },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', UserSchema);