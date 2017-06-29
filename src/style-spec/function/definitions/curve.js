'use strict';

// @flow

const {
    NullType,
    NumberType,
    ColorType,
    typename,
    lambda,
    nargs
} = require('../types');

const { ParsingError, LiteralExpression, LambdaExpression } = require('../expression');

/*::
 import type { Expression, CompiledExpression } from '../expression';
 import type { LambdaType } from '../types';
 type InterpolationType = { name: 'step' } | { name: 'linear' } | { name: 'exponential', base: number }
*/

class CurveExpression extends LambdaExpression {
    interpolation: InterpolationType;
    constructor(key: *, type: *, args: *, interpolation: InterpolationType) {
        super(key, type, args);
        this.interpolation = interpolation;
    }

    static getName() { return 'curve'; }
    static getType() { return lambda(typename('T'), NullType, NumberType, nargs(Infinity, NumberType, typename('T'))); }

    static parse(args, context) {
        // pull out the interpolation type argument for specialized parsing,
        // and replace it with `null` so that other arguments' "key"s stay the
        // same for error reporting.
        const interp = args[0];
        const fixedArgs = [null].concat(args.slice(1));
        const expression: CurveExpression = (super.parse(fixedArgs, context): any);

        if (!Array.isArray(interp) || interp.length === 0)
            throw new ParsingError(`${context.key}.1`, `Expected an interpolation type expression, but found ${String(interp)} instead.`);

        if (interp[0] === 'step') {
            expression.interpolation = { name: 'step' };
        } else if (interp[0] === 'linear') {
            expression.interpolation = { name: 'linear' };
        } else if (interp[0] === 'exponential') {
            const base = interp[1];
            if (typeof base !== 'number')
                throw new ParsingError(`${context.key}.1.1`, `Exponential interpolation requires a numeric base.`);
            expression.interpolation = {
                name: 'exponential',
                base
            };
        } else throw new ParsingError(`${context.key}.1.0`, `Unknown interpolation type ${String(interp[0])}`);
        return expression;
    }

    serialize(withTypes: boolean) {
        const type = this.type.result.name;
        const args = this.args.map(e => e.serialize(withTypes));
        const interp = [this.interpolation.name];
        if (this.interpolation.name === 'exponential') {
            interp.push(this.interpolation.base);
        }
        args.splice(0, 1, interp);
        return [ `curve${(withTypes ? `: ${type}` : '')}` ].concat(args);
    }

    applyType(type: LambdaType, args: Array<Expression>): Expression {
        return new this.constructor(this.key, type, args, this.interpolation);
    }

    compile(args: Array<CompiledExpression>) {
        if (args.length < 4) return {
            errors: [`Expected at least four arguments, but found only ${args.length}.`]
        };

        const firstOutput = args[3];
        let resultType;
        if (firstOutput.type === NumberType) {
            resultType = 'number';
        } else if (firstOutput.type === ColorType) {
            resultType = 'color';
        } else if (
            firstOutput.type.kind === 'array' &&
            firstOutput.type.itemType === NumberType
        ) {
            resultType = 'array';
        } else if (this.interpolation.name !== 'step') {
            return {
                errors: [`Type ${firstOutput.type.name} is not interpolatable, and thus cannot be used as a ${this.interpolation.name} curve's output type.`]
            };
        }

        const stops = [];
        const outputs = [];
        for (let i = 2; (i + 1) < args.length; i += 2) {
            const input = args[i].expression;
            const output = args[i + 1];
            if (
                !(input instanceof LiteralExpression) ||
                typeof input.value !== 'number'
            ) {
                return {
                    errors: [ 'Input/output pairs for "curve" expressions must be defined using literal numeric values (not computed expressions) for the input values.' ]
                };
            }

            if (stops.length && stops[stops.length - 1] > input.value) {
                return {
                    errors: [ 'Input/output pairs for "curve" expressions must be arranged with input values in strictly ascending order.' ]
                };
            }

            stops.push(input.value);
            outputs.push(output.js);
        }

        return {js: `
        (function () {
            var input = ${args[1].js};
            var stopInputs = [${stops.join(', ')}];
            var stopOutputs = [${outputs.map(o => `() => ${o}`).join(', ')}];
            return this.evaluateCurve(input, stopInputs, stopOutputs, ${JSON.stringify(this.interpolation)}, ${JSON.stringify(resultType)});
        }.bind(this))()`};
    }
}

module.exports = CurveExpression;
