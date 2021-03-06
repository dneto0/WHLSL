/*
 * Copyright 2018 Apple Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright notice,
 *       this list of conditions and the following disclaimer in the documentation
 *       and/or other materials provided with the distribution.
 *
 *    3. Neither the name of the copyright holder nor the names of its
 *       contributors may be used to endorse or promote products derived from this
 *       software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { typeOf } from "./TypeOf.mjs";

import { ArrayType } from "../ArrayType.mjs";
import { EnumType } from "../EnumType.mjs";
import { MatrixType } from "../MatrixType.mjs";
import { JSONNameMangler } from "./JSONNameMangler.mjs";
import { NativeType } from "../NativeType.mjs";
import { PtrType } from "../PtrType.mjs";
import { VectorType } from "../VectorType.mjs";
import { Visitor } from "../Visitor.mjs";

export class JSONTypeUnifier extends Visitor {

    constructor()
    {
        super();

        this._allTypes = new Set();
    }

    get allTypes()
    {
        return this._allTypes;
    }

    uniqueTypeId(type)
    {
        const result = type.visit(this);
        if (!result)
            throw new Error(`${type} has no unique type ID.`);
        return result;
    }

    visitTypeRef(node)
    {
        if ((node.typeArguments && node.typeArguments.length) || !node.name) {
            return node.type.visit(this);
        }

        if (!this._allTypes.has(node.type))
            node.type.visit(this);

        const baseType = typeOf(node);

        if (baseType instanceof NativeType || baseType instanceof VectorType || baseType instanceof MatrixType || baseType instanceof EnumType || baseType instanceof ArrayType)
            return baseType.visit(this);

        return node.name;
    }

    visitStructType(node)
    {
        this._allTypes.add(node);
        for (let field of node.fields)
            field.visit(this);
        node._typeID = node.name;
        return node._typeID;
    }

    visitEnumType(node)
    {
        this._allTypes.add(node);
        node._typeID = node.baseType.visit(this);
        return node._typeID;
    }

    visitNativeType(node)
    {
        this._allTypes.add(node);
        node._typeID = node.name;
        return node._typeID;
    }

    visitPtrType(node)
    {
        this._allTypes.add(node);
        node.elementType.visit(this);
        node._typeID = `${node.elementType.visit(this)}* ${node.addressSpace}`;
        return node._typeID;
    }

    visitArrayType(node)
    {
        this._allTypes.add(node);
        node.elementType.visit(this);
        node._typeID = `${node.elementType.visit(this)}[${node.numElements}]`;
        return node._typeID;
    }

    visitArrayRefType(node)
    {
        this._allTypes.add(node);
        node._typeID = `${node.elementType.visit(this)}[] ${node.addressSpace}`;
        return node._typeID;
    }

    visitVectorType(node)
    {
        this._allTypes.add(node);
        node._typeID = node.toString();
        return node._typeID;
    }

    visitMatrixType(node)
    {
        this._allTypes.add(node);
        node._typeID = node.toString();
        return node._typeID;
    }

    visitMakeArrayRefExpression(node)
    {
        super.visitMakeArrayRefExpression(node);
        node._typeID = node.type.visit(this);
        // When the array ref is declared in JSON it will contained a pointer to the element type. However, the original
        // WHLSL doesn't need to contain the type "pointer to the element type", so we ensure that the type is present
        // here. The logic isn't needed for ConvertPtrToArrayRefExpression because the type is necesssarily present there.
        new PtrType(node.origin, node.addressSpace ? node.addressSpace : "thread", typeOf(node).elementType).visit(this);
        return node._typeID;
    }

    visitGenericLiteralType(node)
    {
        node._typeID = node.type.visit(this);
        return node._typeID;
    }

    typesThatNeedDeclaration()
    {
        const declSet = new Set();
        const nameSet = new Set();
        for (let type of this._allTypes) {
            const name = type.visit(this);
            if (!nameSet.has(name)) {
                declSet.add(type);
                nameSet.add(name);
            }
        }
        return declSet;
    }
}

export { JSONTypeUnifier as default };
