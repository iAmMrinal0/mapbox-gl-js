'use strict';

// @flow

/*::
import type { Type, PrimitiveType, ArrayType, LambdaType } from './types.js';
import type { ExpressionName } from './expression_name.js';
export type Expression = LambdaExpression | LiteralExpression;
export type CompiledExpression = {|
    result: 'success',
    js: string,
    type: Type,
    isFeatureConstant: boolean,
    isZoomConstant: boolean,
    expression: Expression,
    function?: Function
|}

export type LiteralValue = null | string | number | boolean | {} | Array<LiteralValue>

*/

const {
    NullType,
    StringType,
    NumberType,
    BooleanType,
    ObjectType,
    ValueType,
    array
} = require('./types');

const primitiveTypes = {
    string: StringType,
    number: NumberType,
    boolean: BooleanType
};

class ParsingError extends Error {
    key: string;
    constructor(key: string, message: string) {
        super(message);
        this.key = key;
    }
}

class ParsingContext {
    key: string;
    path: Array<number>;
    ancestors: Array<string>;
    definitions: {[string]: Class<LambdaExpression>};
    constructor(definitions: *, path: * = [], ancestors: * = []) {
        this.definitions = definitions;
        this.path = path;
        this.key = path.join('.');
        this.ancestors = ancestors;
    }

    concat(index: number, expressionName: ?string) {
        return new ParsingContext(
            this.definitions,
            this.path.concat(index),
            expressionName ? this.ancestors.concat(expressionName) : this.ancestors
        );
    }
}

class BaseExpression {
    key: string;
    +type: Type;
    constructor(key: *, type: *) {
        this.key = key;
        (this: any).type = type;
    }

    compile(_: Array<CompiledExpression>): {js?: string, isFeatureConstant?: boolean, isZoomConstant?: boolean, errors?: Array<string>} {
        throw new Error('Unimplemented');
    }

    serialize(_: boolean): any {
        throw new Error('Unimplemented');
    }
}

class LiteralExpression extends BaseExpression {
    type: PrimitiveType | ArrayType;
    value: LiteralValue;
    constructor(key: *, type: PrimitiveType | ArrayType, value: LiteralValue) {
        super(key, type);
        this.value = value;
    }

    static parse(value: any, context: ParsingContext) {
        const type = typeof value;
        if (
            type === 'string' ||
            type === 'number' ||
            type === 'boolean'
        ) {
            return new this(context.key, primitiveTypes[type], value);
        }

        if (Array.isArray(value)) {
            let itemType;
            // infer the array's item type
            for (const item of value) {
                const t = primitiveTypes[typeof item];
                if (t && !itemType) {
                    itemType = t;
                } else if (t && itemType === t) {
                    continue;
                } else {
                    itemType = ValueType;
                    break;
                }
            }

            const type = array(itemType || ValueType, value.length);
            return new this(
                context.key,
                type,
                value
            );
        } else if (value && typeof value === 'object') {
            return new this(context.key, ObjectType, value);
        } else {
            throw new ParsingError(context.key, `Expected an array or object, but found ${typeof value} instead`);
        }
    }

    compile() {
        let wrapped = this.value;
        if (Array.isArray(this.value)) {
            wrapped = {
                type: this.type.name,
                items: this.value
            };
        } else if (typeof this.value === 'object') {
            wrapped = {
                type: this.type.name,
                value: this.value
            };
        }
        return { js: JSON.stringify(wrapped) };
    }

    serialize(_: boolean) {
        return this.value;
    }
}

class LambdaExpression extends BaseExpression {
    args: Array<Expression>;
    type: LambdaType;
    constructor(key: *, type: LambdaType, args: Array<Expression>) {
        super(key, type);
        this.args = args;
    }

    applyType(type: LambdaType, args: Array<Expression>): Expression {
        return new this.constructor(this.key, type, args);
    }

    serialize(withTypes: boolean) {
        const name = this.constructor.getName();
        const type = this.type.kind === 'lambda' ? this.type.result.name : this.type.name;
        const args = this.args.map(e => e.serialize(withTypes));
        return [ name + (withTypes ? `: ${type}` : '') ].concat(args);
    }

    // implemented by subclasses
    static getName(): ExpressionName { throw new Error('Unimplemented'); }
    static getType(): LambdaType { throw new Error('Unimplemented'); }

    // default parse; overridden by some subclasses
    static parse(args: Array<mixed>, context: ParsingContext): LambdaExpression {
        const op = this.getName();
        const parsedArgs: Array<Expression> = [];
        for (const arg of args) {
            parsedArgs.push(parseExpression(arg, context.concat(1 + parsedArgs.length, op)));
        }

        return new this(context.key, this.getType(), parsedArgs);
    }
}

function parseExpression(expr: mixed, context: ParsingContext) : Expression {
    const key = context.key;
    if (expr === null || typeof expr === 'undefined')
        return new LiteralExpression(key, NullType, null);

    if (primitiveTypes[typeof expr])
        return LiteralExpression.parse(expr, context);

    if (!Array.isArray(expr)) {
        throw new ParsingError(key, `Expected an array, but found ${typeof expr} instead.`);
    }

    const op = expr[0];
    if (typeof op !== 'string') {
        throw new ParsingError(`${key}.0`, `Expression name must be a string, but found ${typeof op} instead.`);
    }

    if (op === 'literal') {
        if (expr.length !== 2)
            throw new ParsingError(key, `'literal' expression requires exactly one argument, but found ${expr.length - 1} instead.`);
        return LiteralExpression.parse(expr[1], context.concat(1, 'literal'));
    }

    const Expr = context.definitions[op];
    if (!Expr) {
        throw new ParsingError(`${key}.0`, `Unknown expression "${op}"`);
    }

    return Expr.parse(expr.slice(1), context);
}

module.exports = {
    ParsingContext,
    ParsingError,
    parseExpression,
    LiteralExpression,
    LambdaExpression
};
