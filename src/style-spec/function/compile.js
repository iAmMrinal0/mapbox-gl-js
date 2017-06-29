'use strict';
// @flow

const assert = require('assert');

module.exports = compileExpression;

const {
    LiteralExpression,
    parseExpression,
    ParsingContext,
    ParsingError
} = require('./expression');
const expressions = require('./definitions');
const typecheck = require('./type_check');
const evaluationContext = require('./evaluation_context');

/*::
 import type { Type } from './types.js';
 import type { Expression, CompiledExpression } from './expression.js';

 type CompileError = {|
     error: string,
     key: string
 |}

 type CompileErrors = {|
     result: 'error',
     errors: Array<CompileError>
 |}
 */

/**
 *
 * Given a style function expression object, returns:
 * ```
 * {
 *   result: 'success',
 *   isFeatureConstant: boolean,
 *   isZoomConstant: boolean,
 *   js: string,
 *   function: Function
 * }
 * ```
 * or else
 *
 * ```
 * {
 *   result: 'error',
 *   errors: Array<CompileError>
 * }
 * ```
 *
 * @private
 */
function compileExpression(
    expr: mixed,
    expectedType?: Type
) {
    let parsed;
    try {
        parsed = parseExpression(expr, new ParsingContext(expressions));
    } catch (e) {
        if (e instanceof ParsingError) {
            return {
                result: 'error',
                errors: [{key: e.key, error: e.message}]
            };
        }
        throw e;
    }

    if (parsed.type) {
        const checked = typecheck(expectedType || parsed.type, parsed);
        if (checked.result === 'error') {
            return checked;
        }

        const compiled = compile(null, checked.expression);
        if (compiled.result === 'success') {
            try {
                const fn = new Function('mapProperties', 'feature', `
        mapProperties = mapProperties || {};
        if (feature && typeof feature === 'object') {
            feature = this.object(feature);
        }
        var props;
        if (feature && feature.type === 'Object') {
            props = (typeof feature.value.properties === 'object') ?
                this.object(feature.value.properties) : feature.value.properties;
        }
        if (!props) { props = this.object({}); }
        return this.unwrap(${compiled.js})
        `);
                compiled.function = fn.bind(evaluationContext());
            } catch (e) {
                console.log(compiled.js);
                throw e;
            }
        }

        return compiled;
    }

    assert(false, 'parseExpression should always return either error or typed expression');
}

function compile(expected: Type | null, e: Expression) /*: CompiledExpression | CompileErrors */ {
    if (e instanceof LiteralExpression) {
        return {
            result: 'success',
            js: e.compile().js,
            type: e.type,
            isFeatureConstant: true,
            isZoomConstant: true,
            expression: e
        };
    } else {
        const errors: Array<CompileError> = [];
        const compiledArgs: Array<CompiledExpression> = [];

        for (let i = 0; i < e.args.length; i++) {
            const arg = e.args[i];
            const param = e.type.params[i];
            const compiledArg = compile(param, arg);
            if (compiledArg.result === 'error') {
                errors.push.apply(errors, compiledArg.errors);
            } else if (compiledArg.result === 'success') {
                compiledArgs.push(compiledArg);
            }
        }

        if (errors.length > 0) {
            return { result: 'error', errors };
        }

        let isFeatureConstant = compiledArgs.reduce((memo, arg) => memo && arg.isFeatureConstant, true);
        let isZoomConstant = compiledArgs.reduce((memo, arg) => memo && arg.isZoomConstant, true);

        const compiled = e.compile(compiledArgs);
        if (compiled.errors) {
            return {
                result: 'error',
                errors: compiled.errors.map(message => ({ error: message, key: e.key }))
            };
        }

        if (typeof compiled.isFeatureConstant === 'boolean') {
            isFeatureConstant = isFeatureConstant && compiled.isFeatureConstant;
        }
        if (typeof compiled.isZoomConstant === 'boolean') {
            isZoomConstant = isZoomConstant && compiled.isZoomConstant;
        }

        assert(compiled.js);

        return {
            result: 'success',
            js: `(${compiled.js || 'void 0'})`, // `|| void 0` is to satisfy flow
            type: e.type.result,
            isFeatureConstant,
            isZoomConstant,
            expression: e
        };
    }
}

