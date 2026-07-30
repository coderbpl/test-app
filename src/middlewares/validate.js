import { ValidationError } from '../utils/ApiError.js';

/**
 * Builds a middleware that validates a request property against a Joi schema, replacing it with
 * the coerced value on success or forwarding a 422 on failure.
 *
 * @param {import('joi').Schema} schema
 * @param {'body'|'params'|'query'} [source]
 * @returns {import('express').RequestHandler}
 */
export function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], { abortEarly: false, convert: true, stripUnknown: true });
        if (error) {
            const message = error.details.map((d) => d.message.replace(/"/g, '')).join('; ');
            return next(new ValidationError(message));
        }
        // req.query is a getter-only in some Express versions; redefine rather than assign.
        if (source === 'query') {
            Object.defineProperty(req, 'query', { value, writable: true, configurable: true, enumerable: true });
        } else {
            req[source] = value;
        }
        next();
    };
}

export const validateBody = (schema) => validate(schema, 'body');
export const validateParams = (schema) => validate(schema, 'params');
export const validateQuery = (schema) => validate(schema, 'query');
