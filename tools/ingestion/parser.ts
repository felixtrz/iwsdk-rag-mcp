/**
 * TypeScript/JavaScript parser using ts-morph
 *
 * Extracts code chunks with semantic understanding using the TypeScript Compiler API.
 * Much simpler and more powerful than tree-sitter!
 */

import { Project, SourceFile, Node, SyntaxKind, ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration, MethodDeclaration, PropertyDeclaration } from 'ts-morph';
import { TypeScriptChunk } from './types.js';
import * as path from 'path';

export class TypeScriptParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      // Don't load tsconfig, we want to parse files independently
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
      }
    });
    console.error('✅ TypeScript/JavaScript parser initialized (ts-morph)');
  }

  /**
   * Parse a TypeScript or JavaScript file and extract code chunks
   */
  parseFile(filePath: string): TypeScriptChunk[] {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const chunks: TypeScriptChunk[] = [];

    // Determine language from extension
    const ext = path.extname(filePath);
    const language: 'typescript' | 'javascript' =
      (ext === '.ts' || ext === '.tsx') ? 'typescript' : 'javascript';

    // Extract all imports for reference
    const imports = this.extractImports(sourceFile);

    // Extract classes
    for (const cls of sourceFile.getClasses()) {
      chunks.push(...this.extractClass(cls, filePath, language, imports));
    }

    // Extract standalone functions
    for (const func of sourceFile.getFunctions()) {
      chunks.push(this.extractFunction(func, filePath, language, imports));
    }

    // Extract interfaces
    for (const iface of sourceFile.getInterfaces()) {
      chunks.push(this.extractInterface(iface, filePath, language));
    }

    // Extract type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      chunks.push(this.extractTypeAlias(typeAlias, filePath, language));
    }

    // Extract enums
    for (const enumDecl of sourceFile.getEnums()) {
      chunks.push(this.extractEnum(enumDecl, filePath, language));
    }

    // Extract top-level const/let/var declarations
    for (const varStatement of sourceFile.getVariableStatements()) {
      chunks.push(...this.extractVariables(varStatement, filePath, language, imports));
    }

    // Extract ECS factory patterns (createComponent/createSystem)
    chunks.push(...this.extractECSFactoryPatterns(sourceFile, filePath, language, imports));

    // Remove the source file from project to avoid memory leaks
    this.project.removeSourceFile(sourceFile);

    return chunks;
  }

  private extractImports(sourceFile: SourceFile): string[] {
    const imports: string[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpec = importDecl.getModuleSpecifierValue();
      const namedImports = importDecl.getNamedImports().map(ni => ni.getName());
      const defaultImport = importDecl.getDefaultImport()?.getText();

      if (defaultImport) {
        imports.push(`import ${defaultImport} from '${moduleSpec}'`);
      }
      if (namedImports.length > 0) {
        imports.push(`import { ${namedImports.join(', ')} } from '${moduleSpec}'`);
      }
    }

    return imports;
  }

  private extractClass(
    cls: ClassDeclaration,
    filePath: string,
    language: 'typescript' | 'javascript',
    imports: string[]
  ): TypeScriptChunk[] {
    const chunks: TypeScriptChunk[] = [];
    const className = cls.getName() || 'AnonymousClass';

    // Main class chunk
    const classChunk: TypeScriptChunk = {
      content: cls.getText(),
      chunk_type: 'class',
      name: className,
      start_line: cls.getStartLineNumber(),
      end_line: cls.getEndLineNumber(),
      file_path: filePath,
      language,
      imports,
      exports: cls.isExported() ? ['default', className] : [],
      type_parameters: cls.getTypeParameters().map(tp => tp.getName()),
      decorators: cls.getDecorators().map(d => d.getName()),
      calls: [],
      extends: cls.getExtends() ? [cls.getExtends()!.getText()] : [],
      implements: cls.getImplements().map(i => i.getText()),
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: [],
      three_js_usage: [],
      semantic_labels: [],
    };

    // Detect ECS patterns
    if (this.isECSComponent(cls)) {
      classChunk.ecs_component = true;
      classChunk.semantic_labels.push('ecs-component');
    }
    if (this.isECSSystem(cls)) {
      classChunk.ecs_system = true;
      classChunk.semantic_labels.push('ecs-system');
    }

    // Detect WebXR API usage
    classChunk.webxr_api_usage = this.detectWebXRUsage(cls.getText());

    // Detect Three.js usage
    classChunk.three_js_usage = this.detectThreeJsUsage(cls.getText());

    chunks.push(classChunk);

    // Extract methods as separate chunks
    for (const method of cls.getMethods()) {
      chunks.push(this.extractMethod(method, filePath, language, className, imports));
    }

    return chunks;
  }

  private extractFunction(
    func: FunctionDeclaration,
    filePath: string,
    language: 'typescript' | 'javascript',
    imports: string[]
  ): TypeScriptChunk {
    const funcName = func.getName() || 'anonymous';

    return {
      content: func.getText(),
      chunk_type: 'function',
      name: funcName,
      start_line: func.getStartLineNumber(),
      end_line: func.getEndLineNumber(),
      file_path: filePath,
      language,
      imports,
      exports: func.isExported() ? [funcName] : [],
      type_parameters: func.getTypeParameters().map(tp => tp.getName()),
      decorators: [],
      calls: this.extractFunctionCalls(func),
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: this.detectWebXRUsage(func.getText()),
      three_js_usage: this.detectThreeJsUsage(func.getText()),
      semantic_labels: [],
    };
  }

  private extractMethod(
    method: MethodDeclaration,
    filePath: string,
    language: 'typescript' | 'javascript',
    className: string,
    imports: string[]
  ): TypeScriptChunk {
    const methodName = method.getName();

    return {
      content: method.getText(),
      chunk_type: 'method',
      name: `${className}.${methodName}`,
      start_line: method.getStartLineNumber(),
      end_line: method.getEndLineNumber(),
      file_path: filePath,
      language,
      class_name: className,
      imports,
      exports: [],
      type_parameters: method.getTypeParameters().map(tp => tp.getName()),
      decorators: method.getDecorators().map(d => d.getName()),
      calls: this.extractFunctionCalls(method),
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: this.detectWebXRUsage(method.getText()),
      three_js_usage: this.detectThreeJsUsage(method.getText()),
      semantic_labels: [],
    };
  }

  private extractInterface(
    iface: InterfaceDeclaration,
    filePath: string,
    language: 'typescript' | 'javascript'
  ): TypeScriptChunk {
    const name = iface.getName();

    return {
      content: iface.getText(),
      chunk_type: 'interface',
      name,
      start_line: iface.getStartLineNumber(),
      end_line: iface.getEndLineNumber(),
      file_path: filePath,
      language,
      imports: [],
      exports: iface.isExported() ? [name] : [],
      type_parameters: iface.getTypeParameters().map(tp => tp.getName()),
      decorators: [],
      calls: [],
      extends: iface.getExtends().map(e => e.getText()),
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: [],
      three_js_usage: [],
      semantic_labels: [],
    };
  }

  private extractTypeAlias(
    typeAlias: TypeAliasDeclaration,
    filePath: string,
    language: 'typescript' | 'javascript'
  ): TypeScriptChunk {
    const name = typeAlias.getName();

    return {
      content: typeAlias.getText(),
      chunk_type: 'type',
      name,
      start_line: typeAlias.getStartLineNumber(),
      end_line: typeAlias.getEndLineNumber(),
      file_path: filePath,
      language,
      imports: [],
      exports: typeAlias.isExported() ? [name] : [],
      type_parameters: typeAlias.getTypeParameters().map(tp => tp.getName()),
      decorators: [],
      calls: [],
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: [],
      three_js_usage: [],
      semantic_labels: [],
    };
  }

  private extractEnum(
    enumDecl: EnumDeclaration,
    filePath: string,
    language: 'typescript' | 'javascript'
  ): TypeScriptChunk {
    const name = enumDecl.getName();

    return {
      content: enumDecl.getText(),
      chunk_type: 'enum',
      name,
      start_line: enumDecl.getStartLineNumber(),
      end_line: enumDecl.getEndLineNumber(),
      file_path: filePath,
      language,
      imports: [],
      exports: enumDecl.isExported() ? [name] : [],
      type_parameters: [],
      decorators: [],
      calls: [],
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: [],
      three_js_usage: [],
      semantic_labels: [],
    };
  }

  private extractVariables(
    varStatement: any,
    filePath: string,
    language: 'typescript' | 'javascript',
    imports: string[]
  ): TypeScriptChunk[] {
    const chunks: TypeScriptChunk[] = [];

    for (const declaration of varStatement.getDeclarations()) {
      const name = declaration.getName();
      const initializer = declaration.getInitializer();

      // Only include if it has a meaningful initializer (function, object, etc.)
      if (initializer && initializer.getText().length > 20) {
        chunks.push({
          content: varStatement.getText(),
          chunk_type: initializer.getKind() === SyntaxKind.ArrowFunction ||
                     initializer.getKind() === SyntaxKind.FunctionExpression ? 'function' : 'const',
          name,
          start_line: varStatement.getStartLineNumber(),
          end_line: varStatement.getEndLineNumber(),
          file_path: filePath,
          language,
          imports,
          exports: varStatement.isExported() ? [name] : [],
          type_parameters: [],
          decorators: [],
          calls: [],
          extends: [],
          implements: [],
          uses_types: [],
          ecs_component: false,
          ecs_system: false,
          webxr_api_usage: this.detectWebXRUsage(varStatement.getText()),
          three_js_usage: this.detectThreeJsUsage(varStatement.getText()),
          semantic_labels: [],
        });
      }
    }

    return chunks;
  }

  private extractFunctionCalls(node: Node): string[] {
    const calls: string[] = [];

    node.forEachDescendant((descendant) => {
      if (Node.isCallExpression(descendant)) {
        const expr = descendant.getExpression();
        calls.push(expr.getText());
      }
    });

    return calls;
  }

  private isECSComponent(cls: ClassDeclaration): boolean {
    const name = cls.getName() || '';

    // Check if extends Component (strict check for class name, not any occurrence)
    const extendsNode = cls.getExtends();
    const extendsText = extendsNode?.getText() || '';
    // Match "Component" or "SomeComponent" but not "InputComponent.A_Button"
    // Check if the base class name itself is or ends with "Component"
    const extendsComponent = /\b\w*Component\b/.test(extendsText.split(/[.\(]/)[0]);

    const hasComponentDecorator = cls.getDecorators().some(d => d.getName().toLowerCase().includes('component'));

    // Systems should never be components - if it ends with "System", it's a system
    const isSystem = name.endsWith('System');
    if (isSystem) {
      return false;
    }

    return extendsComponent || hasComponentDecorator;
  }

  private isECSSystem(cls: ClassDeclaration): boolean {
    const name = cls.getName() || '';

    // Check if extends System or has "System" in name
    const extendsNode = cls.getExtends();
    const extendsText = extendsNode?.getText() || '';
    // Strict check: match "System" or "SomeSystem" at word boundary
    const extendsSystem = /\bSystem\b/.test(extendsText);
    const hasSystemInName = name.endsWith('System');

    return extendsSystem || hasSystemInName;
  }

  private detectWebXRUsage(text: string): string[] {
    const webxrAPIs = [
      'XRSession', 'XRFrame', 'XRReferenceSpace', 'XRView', 'XRViewport',
      'XRPose', 'XRRigidTransform', 'XRInputSource', 'XRHand', 'XRHitTestResult',
      'XRLayer', 'XRWebGLLayer', 'XRAnchor', 'XRPlane', 'XRMesh',
      'requestSession', 'requestAnimationFrame', 'requestReferenceSpace'
    ];

    const found: string[] = [];
    for (const api of webxrAPIs) {
      if (text.includes(api)) {
        found.push(api);
      }
    }

    return found;
  }

  private detectThreeJsUsage(text: string): string[] {
    const threeAPIs = [
      'THREE.', 'Scene', 'PerspectiveCamera', 'WebGLRenderer', 'Mesh',
      'Geometry', 'Material', 'Texture', 'Light', 'Object3D'
    ];

    const found: string[] = [];
    for (const api of threeAPIs) {
      if (text.includes(api)) {
        found.push(api);
      }
    }

    return found;
  }

  /**
   * Extract ECS factory patterns (createComponent/createSystem)
   *
   * IWSDK uses factory functions instead of classes:
   * export const AudioComponent = createComponent(...)
   * export const RenderSystem = createSystem(...)
   */
  private extractECSFactoryPatterns(
    sourceFile: SourceFile,
    filePath: string,
    language: 'typescript' | 'javascript',
    imports: string[]
  ): TypeScriptChunk[] {
    const chunks: TypeScriptChunk[] = [];

    // Find all variable statements
    for (const varStatement of sourceFile.getVariableStatements()) {
      for (const declaration of varStatement.getDeclarations()) {
        const initializer = declaration.getInitializer();

        // Check if initializer is a call expression
        if (!initializer || !Node.isCallExpression(initializer)) {
          continue;
        }

        // Get the function being called
        const expression = initializer.getExpression();
        const funcName = expression.getText();

        // Check if it's createComponent or createSystem
        const isComponent = funcName.includes('createComponent');
        const isSystem = funcName.includes('createSystem');

        if (!isComponent && !isSystem) {
          continue;
        }

        // Extract component/system name
        const name = declaration.getName();

        // Create chunk
        const chunk: TypeScriptChunk = {
          content: varStatement.getText(),
          chunk_type: isComponent ? 'component' : 'system',
          name,
          start_line: varStatement.getStartLineNumber(),
          end_line: varStatement.getEndLineNumber(),
          file_path: filePath,
          language,
          imports,
          exports: varStatement.isExported() ? [name] : [],
          type_parameters: [],
          decorators: [],
          calls: [funcName],
          extends: isComponent ? ['Component'] : ['System'],
          implements: [],
          uses_types: [],
          ecs_component: isComponent,
          ecs_system: isSystem,
          webxr_api_usage: this.detectWebXRUsage(varStatement.getText()),
          three_js_usage: this.detectThreeJsUsage(varStatement.getText()),
          semantic_labels: [isComponent ? 'ecs-component' : 'ecs-system'],
        };

        chunks.push(chunk);
      }
    }

    return chunks;
  }
}
