import mongoose from 'mongoose'
import { TickType } from './TickTypes'

const { Schema } = mongoose

export const TickSchema = new Schema<TickType>({
  name: { type: Schema.Types.String, required: true, index: true },
  notes: { type: Schema.Types.String, required: false },
  climbId: { type: Schema.Types.String, required: true, index: true },
  userId: { type: Schema.Types.String, required: true, index: true },
  style: { type: Schema.Types.String, required: true, default: '' },
  attemptType: { type: Schema.Types.String, required: true, index: true, default: '' },
  dateClimbed: { type: Schema.Types.String, required: true },
  grade: { type: Schema.Types.String, required: true, index: true },
  source: { type: Schema.Types.String, enum: ['MP', 'OB'], required: true, index: true }
})

TickSchema.index({ climbId: 1, dateClimbed: 1, style: 1, userId: 1, source: 1 }, { unique: true })

export const getTickModel = (name: string = 'ticks'): mongoose.Model<TickType> => {
  return mongoose.model(name, TickSchema)
}
