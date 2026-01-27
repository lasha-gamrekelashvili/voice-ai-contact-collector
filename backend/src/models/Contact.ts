import mongoose, { Document, Schema } from 'mongoose';
import validator from 'validator';
import { MAX_NAME_LENGTH, MAX_EMAIL_LENGTH, MAX_PHONE_LENGTH } from '../utils/constants';

export interface IContact extends Document {
  name: string;
  email: string;
  phone: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [MAX_NAME_LENGTH, `Name cannot exceed ${MAX_NAME_LENGTH} characters`]
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: [MAX_EMAIL_LENGTH, `Email cannot exceed ${MAX_EMAIL_LENGTH} characters`],
      validate: {
        validator: (v: string) => validator.isEmail(v),
        message: 'Invalid email format'
      }
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
      maxlength: [MAX_PHONE_LENGTH, `Phone cannot exceed ${MAX_PHONE_LENGTH} characters`]
    }
  },
  {
    timestamps: true
  }
);

export const Contact = mongoose.model<IContact>('Contact', ContactSchema);
