import mongoose, { Document, Schema } from 'mongoose';

export interface IEquipment extends Document {
  locationId:     string;
  name:           string;
  is_fully_paid:  boolean;
  monthly_cost:   number;
  createdAt:      Date;
  updatedAt:      Date;
}

const EquipmentSchema = new Schema<IEquipment>(
  {
    locationId:    { type: String, required: true, index: true },
    name:          { type: String, required: true },
    is_fully_paid: { type: Boolean, default: false },
    monthly_cost:  { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Equipment = mongoose.model<IEquipment>('Equipment', EquipmentSchema);
