import Joi from 'joi';

export const loginSchema = Joi.object({
    // tlds:false so internal domains like *.local are accepted (Joi validates against the
    // IANA TLD list by default, which would reject the seeded admin@grievance.local).
    email: Joi.string().email({ tlds: { allow: false } }).required(),
    password: Joi.string().min(1).required()
});
