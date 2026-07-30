import { ValidationError } from '../utils/ApiError.js';

export function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], { abortEarly: false, convert: true, stripUnknown: true });
        if (error) return next(new ValidationError(error.details.map((d) => d.message.replace(/"/g, '')).join('; ')));
        if (source === 'query') {
            Object.defineProperty(req, 'query', { value, writable: true, configurable: true, enumerable: true });
        } else {
            req[source] = value;
        }
        next();
    };
}
export const validateBody = (s) => validate(s, 'body');
export const validateParams = (s) => validate(s, 'params');
export const validateQuery = (s) => validate(s, 'query');
