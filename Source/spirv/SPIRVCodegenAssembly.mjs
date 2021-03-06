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

class ProgramHelper {
    constructor(programDescription)
    {
        this._program = programDescription;
    }

    get types()
    {
        return this._program.source.types;
    }

    get literals()
    {
        return this._program.source.literals;
    }

    get functions()
    {
        return this._program.source.functions;
    }

    get entryPoints()
    {
        if (!this._entryPoints) {
            this._entryPoints = Array.from(this._program.source.entryPoints);
            for (let entryPoint of this._entryPoints) {
                let func = this._findFunctionNamed(entryPoint.name);
                entryPoint.func = func;
            }
        }
        return this._entryPoints;
    }

    _findFunctionNamed(name)
    {
        for (let func of this._program.source.functions) {
            if (func.name == name)
                return func;
        }
        return null;
    }
}

export function generateSPIRVAssembly(spirv, programDescription, assembler)
{
    let program = new ProgramHelper(programDescription);
    let currentId = assembler.largestId;
    let typeMap = new Map();
    let reverseTypeMap = new Map();

    // Collect all the types.
    for (let type of program.types) {
        typeMap.set(++currentId, type);
        reverseTypeMap.set(type.name, currentId);
    }

    // Give each entry point an identifier.
    for (let entryPoint of program.entryPoints) {
        entryPoint.func.id = ++currentId;
    }

    // 1. All OpCapability instructions
    assembler.blankLine();
    assembler.append(new spirv.ops.Capability(spirv.kinds.Capability.Shader));

    // 2. Optional OpExtension instructions
    // 3. Optional OpExtInstImport instructions

    // 4. The single required OpMemoryModel instruction
    assembler.append(new spirv.ops.MemoryModel(spirv.kinds.AddressingModel.Logical, spirv.kinds.MemoryModel.GLSL450));
    assembler.lineComment("FIXME: Is GLSL540 correct?");

    // 5. All entry point declarations
    for (let entryPoint of program.entryPoints) {
        let executionModel;
        switch (entryPoint.type) {
        case "vertex":
            executionModel = spirv.kinds.ExecutionModel.Vertex;
            break;
        case "fragment":
            executionModel = spirv.kinds.ExecutionModel.Fragment;
            break;
        }
        let interfaceIds = []
        // for (let value of entryPoint.inputs)
        //     interfaceIds.push(value.id);
        // for (let value of entryPoint.outputs)
        //     interfaceIds.push(value.id);
        assembler.append(new spirv.ops.EntryPoint(executionModel, entryPoint.func.id, entryPoint.name, ...interfaceIds));
    }

    // 6. All execution mode declarations
    for (let entryPoint of program.entryPoints) {
        assembler.append(new spirv.ops.ExecutionMode(entryPoint.func.id, spirv.kinds.ExecutionMode.OriginLowerLeft));
    }

    // 7. Optional debug instructions
    assembler.blankLine();
    assembler.comment("Debug information");
    assembler.append(new spirv.ops.Source(spirv.kinds.SourceLanguage.Unknown, 1));
    assembler.lineComment("WHLSL Compiler");
    // Output names for functions.
    for (let entryPoint of program.entryPoints) {
        assembler.append(new spirv.ops.Name(entryPoint.func.id, entryPoint.name));
    }
    // Output names for struct types.
    [...typeMap].filter(([id, type]) => {
        return type.type == "struct";
    }).forEach(([id, type]) => {
        assembler.append(new spirv.ops.Name(id, type.name));
        for (let i = 0; i < type.fields.length; i++) {
            const field = type.fields[i];
            assembler.append(new spirv.ops.MemberName(id, i, field.name));
        }
    });

    // 8. All annotation instructions

    // 9. All type declarations, all constant instructions, and all global variable declarations
    assembler.blankLine();
    assembler.comment("Types");
    for (let [id, type] of typeMap) {
        if (type.type == "native") {
            switch (type.name) {
            case "void":
                assembler.append(new spirv.ops.TypeVoid(id));
                break;
            case "float":
                assembler.append(new spirv.ops.TypeFloat(id, 32));
                break;
            default:
                assembler.error(`Unhandled native type: ${type.name}`);
            }
        } else if (type.type == "vector") {
            let idOfBaseType = reverseTypeMap.get(type.elementType);
            assembler.append(new spirv.ops.TypeVector(id, idOfBaseType, type.length));
        } else if (type.type == "struct") {
            let fieldIds = [];
            for (let field of type.fields) {
                let fieldTypeId = reverseTypeMap.get(field.type)
                fieldIds.push(fieldTypeId);
            }
            assembler.append(new spirv.ops.TypeStruct(id, ...fieldIds));
        } else if (type.type == "pointer") {
            let idOfReferencedType = reverseTypeMap.get(type.to);
            let storageClass;
            switch (type.addressSpace) {
            case "thread":
                storageClass = spirv.kinds.StorageClass.Private;
                break;
            default:
                assembler.error(`Unhandled pointer storage class: ${type.addressSpace}`);
                continue;
            }
            assembler.append(new spirv.ops.TypePointer(id, storageClass, idOfReferencedType));
        } else {
            assembler.error(`Unhandled type: ${type.type}`);
        }
        assembler.lineComment(type.name);
    }

    if (program.literals && program.literals.length) {
        assembler.blankLine();
        assembler.comment("Constants");

        // FIXME: This will have to be precomputed so that we can find them later.
        for (let literal of program.literals) {
            let idOfLiteralType = reverseTypeMap.get(literal.literalType);
            assembler.append(new spirv.ops.Constant(idOfLiteralType, ++currentId, literal.value));
            assembler.lineComment(`${literal.literalType} ${literal.value}`);
        }
    }

    // 10. All function declarations

    assembler.blankLine();
    assembler.comment("Function declarations");
    for (let func of program.functions) {
        // If this is an entry point, we've already given it an id. If
        // not, create a new one.
        if (!func.id) {
            func.id = ++currentId;
        }

        let parameterIds = [];
        let parameterTypeNames = [];
        for (let param of func.parameters) {
            if (param.defaultFunctionParameter) {
                let paramTypeName = `${param.type.elementType.name}* ${param.type.addressSpace}`;
                let paramTypeId = reverseTypeMap.get(paramTypeName);
                parameterIds.push(paramTypeId);
                parameterTypeNames.push(paramTypeName);
            } else {
                let paramTypeId = reverseTypeMap.get(param.type.name);
                parameterIds.push(paramTypeId);
                parameterTypeNames.push(param.type.name);
            }
        }

        let idOfReturnType = reverseTypeMap.get(func.cast ? "void" : func.returnType.name);
        assembler.append(new spirv.ops.TypeFunction(func.id, idOfReturnType, ...parameterIds));
        assembler.lineComment(`${func.name}(${parameterTypeNames.join(", ")})`);
    }

    // 11. All function definitions
}

export { generateSPIRVAssembly as default };
