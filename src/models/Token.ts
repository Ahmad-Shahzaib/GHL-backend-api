import mongoose, { Document, Schema } from 'mongoose';

export interface IToken extends Document {
  key:          string;
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
  scope:        string;
  userType:     string;
  companyId?:   string;
  locationId?:  string;
  userId?:      string;
  createdAt:    Date;
  updatedAt:    Date;
}

const TokenSchema = new Schema<IToken>(
  {
    key:          { type: String, required: true, unique: true, index: true },
    accessToken:  { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt:    { type: Number, required: true },
    scope:        { type: String, default: '' },
    userType:     { type: String, default: 'Location' },
    companyId:    { type: String },
    locationId:   { type: String },
    userId:       { type: String },
  },
  { timestamps: true }
);

export const Token = mongoose.model<IToken>('Token', TokenSchema);