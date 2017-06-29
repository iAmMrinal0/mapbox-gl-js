'use strict';

// @flow

const assert = require('assert');

const {
    NumberType,
    StringType,
    BooleanType,
    ColorType,
    ObjectType,
    ValueType,
    typename,
    variant,
    array,
    lambda,
    nargs
} = require('../types');

const { ParsingError, LambdaExpression } = require('../expression');

const MatchExpression = require('./match');
const CurveExpression = require('./curve');

/*::
 import type { Type, PrimitiveType, ArrayType, LambdaType } from '../types.js';
 import type { ExpressionName } from '../expression_name.js';
 import type { CompiledExpression } from '../expression.js';
 */

const expressions: { [string]: Class<LambdaExpression> } = {
    'ln2': defineMathConstant('ln2'),
    'pi': defineMathConstant('pi'),
    'e': defineMathConstant('e'),

    'typeof': class TypeOf extends LambdaExpression {
        static getName() { return 'typeOf'; }
        static getType() { return lambda(StringType, ValueType); }
        compile(args) { return fromContext('typeOf', args); }
    },

    // type assertions
    'string': defineAssertion('string', StringType),
    'number': defineAssertion('number', NumberType),
    'boolean': defineAssertion('boolean', BooleanType),
    'array': defineAssertion('array', array(ValueType)),
    'object': defineAssertion('object', ObjectType),

    // type coercion
    'to_string': class extends LambdaExpression {
        static getName() { return 'to_string'; }
        static getType() { return lambda(StringType, ValueType); }
        compile(args) {
            return {js: `this.toString(${args[0].js})`};
        }
    },
    'to_number': class extends LambdaExpression {
        static getName() { return 'to_number'; }
        static getType() { return lambda(NumberType, ValueType); }
        compile(args) {
            return {js: `this.toNumber(${args[0].js})`};
        }
    },
    'to_boolean': class extends LambdaExpression {
        static getName() { return 'to_boolean'; }
        static getType() { return lambda(BooleanType, ValueType); }
        compile(args) {
            return {js: `Boolean(${args[0].js})`};
        }
    },
    'to_rgba': class extends LambdaExpression {
        static getName() { return 'to_rgba'; }
        static getType() { return lambda(array(NumberType, 4), ColorType); }
        compile(args) {
            return {js: `this.array('Array<Number, 4>', ${args[0].js}.value)`};
        }
    },

    // color 'constructors'
    'parse_color': class extends LambdaExpression {
        static getName() { return 'parse_color'; }
        static getType() { return lambda(ColorType, StringType); }
        compile(args) { return fromContext('parseColor', args); }
    },
    'rgb': class extends LambdaExpression {
        static getName() { return 'rgb'; }
        static getType() { return lambda(ColorType, NumberType, NumberType, NumberType); }
        compile(args) { return fromContext('rgba', args); }
    },
    'rgba': class extends LambdaExpression {
        static getName() { return 'rgb'; }
        static getType() { return lambda(ColorType, NumberType, NumberType, NumberType, NumberType); }
        compile(args) { return fromContext('rgba', args); }
    },

    // object/array access
    'get': class extends LambdaExpression {
        static getName() { return 'get'; }
        static getType() { return lambda(ValueType, StringType, nargs(1, ObjectType)); }
        compile(args) {
            return {
                js: `this.get(${args.length > 1 ? args[1].js : 'props'}, ${args[0].js}, ${args.length > 1 ? 'undefined' : '"feature.properties"'})`,
                isFeatureConstant: args.length > 1 && args[1].isFeatureConstant
            };
        }
    },
    'has': class extends LambdaExpression {
        static getName() { return 'has'; }
        static getType() { return lambda(BooleanType, StringType, nargs(1, ObjectType)); }
        compile(args) {
            return {
                js: `this.has(${args.length > 1 ? args[1].js : 'props'}, ${args[0].js}, ${args.length > 1 ? 'undefined' : '"feature.properties"'})`,
                isFeatureConstant: args.length > 1 && args[1].isFeatureConstant
            };
        }
    },
    'at': class extends LambdaExpression {
        static getName() { return 'at'; }
        static getType() { return lambda(typename('T'), NumberType, array(typename('T'))); }
        compile(args) { return fromContext('at', args); }
    },
    'length': class extends LambdaExpression {
        static getName() { return 'length'; }
        static getType() { return lambda(NumberType, variant(array(typename('T')), StringType)); }
        compile(args) {
            let t = args[0].type;
            if (t.kind === 'lambda') { t = t.result; }
            assert(t.kind === 'array' || t.kind === 'primitive');
            return {
                js: t.kind === 'array' ?
                    `${args[0].js}.items.length` :
                    `${args[0].js}.length`
            };
        }
    },

    // // feature and map data
    'properties': class extends LambdaExpression {
        static getName() { return 'properties'; }
        static getType() { return lambda(ObjectType); }
        compile() {
            return {
                js: 'this.as(props, "Object", "feature.properties")',
                isFeatureConstant: false
            };
        }
    },
    'geometry_type': class extends LambdaExpression {
        static getName() { return 'geometry_type'; }
        static getType() { return lambda(StringType); }
        compile() {
            return {
                js: 'this.get(this.get(feature, "geometry", "feature"), "type", "feature.geometry")',
                isFeatureConstant: false
            };
        }
    },
    'id': class extends LambdaExpression {
        static getName() { return 'id'; }
        static getType() { return lambda(ValueType); }
        compile() {
            return {
                js: 'this.get(feature, "id", "feature")',
                isFeatureConstant: false
            };
        }
    },
    'zoom': class extends LambdaExpression {
        static getName() { return 'zoom'; }
        static getType() { return lambda(NumberType); }
        static parse(args, context) {
            const ancestors = context.ancestors.join(':');
            // zoom expressions may only appear like:
            // ['curve', interp, ['zoom'], ...]
            // or ['coalesce', ['curve', interp, ['zoom'], ...], ... ]
            if (
                !/^(1.)?2/.test(context.key) ||
                !/(coalesce:)?curve/.test(ancestors)
            ) {
                throw new ParsingError(
                    context.key,
                    'The "zoom" expression may only be used as the input to a top-level "curve" expression.'
                );
            }
            return super.parse(args, context);
        }
        compile() {
            return {js: 'mapProperties.zoom', isZoomConstant: false};
        }
    },

    // math
    '+': defineBinaryMathOp('+', true),
    '*': defineBinaryMathOp('*', true),
    '-': defineBinaryMathOp('-'),
    '/': defineBinaryMathOp('/'),
    '%': defineBinaryMathOp('%'),
    '^': class extends LambdaExpression {
        static getName() { return '^'; }
        static getType() { return lambda(NumberType, NumberType, NumberType); }
        compile(args) {
            return {js: `Math.pow(${args[0].js}, ${args[1].js})`};
        }
    },
    'log10': defineMathFunction('log10', 1),
    'ln': defineMathFunction('ln', 1, 'log'),
    'log2': defineMathFunction('log2', 1),
    'sin': defineMathFunction('sin', 1),
    'cos': defineMathFunction('cos', 1),
    'tan': defineMathFunction('tan', 1),
    'asin': defineMathFunction('asin', 1),
    'acos': defineMathFunction('acos', 1),
    'atan': defineMathFunction('atan', 1),
    '==': defineComparisonOp('=='),
    '!=': defineComparisonOp('!='),
    '>': defineComparisonOp('>'),
    '<': defineComparisonOp('<'),
    '>=': defineComparisonOp('>='),
    '<=': defineComparisonOp('<='),
    '&&': defineBooleanOp('&&'),
    '||': defineBooleanOp('||'),
    '!': class extends LambdaExpression {
        static getName() { return '!'; }
        static getType() { return lambda(BooleanType, BooleanType); }
        compile(args) {
            return {js: `!(${args[0].js})`};
        }
    },

    // string manipulation
    'upcase': class extends LambdaExpression {
        static getName() { return 'upcase'; }
        static getType() { return lambda(StringType, StringType); }
        compile(args) {
            return {js: `(${args[0].js}).toUpperCase()`};
        }
    },
    'downcase': class extends LambdaExpression {
        static getName() { return 'downcase'; }
        static getType() { return lambda(StringType, StringType); }
        compile(args) {
            return {js: `(${args[0].js}).toLowerCase()`};
        }
    },
    'concat': class extends LambdaExpression {
        static getName() { return 'concat'; }
        static getType() { return lambda(StringType, nargs(Infinity, ValueType)); }
        compile(args) {
            return {js: `[${args.map(a => a.js).join(', ')}].join('')`};
        }
    },

    // decisions
    'case': class extends LambdaExpression {
        static getName() { return 'case'; }
        static getType() { return lambda(typename('T'), nargs(Infinity, BooleanType, typename('T')), typename('T')); }
        compile(args) {
            args = [].concat(args);
            const result = [];
            while (args.length > 1) {
                const c = args.splice(0, 2);
                result.push(`${c[0].js} ? ${c[1].js}`);
            }
            assert(args.length === 1); // enforced by type checking
            result.push(args[0].js);
            return { js: result.join(':') };
        }
    },
    'match': MatchExpression,

    'coalesce': class extends LambdaExpression {
        static getName() { return 'coalesce'; }
        static getType() { return lambda(typename('T'), nargs(Infinity, typename('T'))); }
        compile(args) {
            return {
                js: `this.coalesce(${args.map(a => `() => ${a.js}`).join(', ')})`
            };
        }
    },

    'curve': CurveExpression
};

module.exports = expressions;

function defineMathConstant(name) {
    const mathName = name.toUpperCase();
    assert(typeof Math[mathName] === 'number');
    return class extends LambdaExpression {
        static getName() { return name; }
        static getType() { return lambda(NumberType); }
        compile() { return { js: `Math.${mathName}` }; }
    };
}

function defineMathFunction(name: ExpressionName, arity: number, mathName?: string) {
    const key:string = mathName || name;
    assert(typeof Math[key] === 'function');
    assert(arity > 0);
    const args = [];
    while (arity-- > 0) args.push(NumberType);
    return class extends LambdaExpression {
        static getName() { return name; }
        static getType() { return lambda(NumberType, ...args); }
        compile(args) {
            return { js: `Math.${key}(${args.map(a => a.js).join(', ')})` };
        }
    };
}

function defineBinaryMathOp(name, isAssociative) {
    const args = isAssociative ? [nargs(Infinity, NumberType)] : [NumberType, NumberType];
    return class extends LambdaExpression {
        static getName() { return name; }
        static getType() { return lambda(NumberType, ...args); }
        compile(args) {
            return { js: `${args.map(a => a.js).join(name)}` };
        }
    };
}

function defineComparisonOp(name) {
    const op = name === '==' ? '===' :
        name === '!=' ? '!==' : name;
    return class extends LambdaExpression {
        static getName() { return name; }
        static getType() { return lambda(BooleanType, typename('T'), typename('T')); }
        compile(args) {
            return { js: `${args[0].js} ${op} ${args[1].js}` };
        }
    };
}

function defineBooleanOp(op) {
    return class extends LambdaExpression {
        static getName() { return op; }
        static getType() { return lambda(BooleanType, nargs(Infinity, BooleanType)); }
        compile(args) {
            return { js: `${args.map(a => a.js).join(op)}` };
        }
    };
}

function defineAssertion(name: ExpressionName, type: Type) {
    return class extends LambdaExpression {
        static getName() { return name; }
        static getType() { return lambda(type, ValueType); }
        compile(args) {
            return { js: `this.as(${args[0].js}, ${JSON.stringify(type.name)})` };
        }
    };
}

function fromContext(name: string, args: Array<CompiledExpression>) {
    const argvalues = args.map(a => a.js).join(', ');
    return { js: `this.${name}(${argvalues})` };
}

