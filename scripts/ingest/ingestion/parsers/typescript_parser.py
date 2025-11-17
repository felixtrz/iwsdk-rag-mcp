"""
TypeScript/JavaScript parser using tree-sitter.

Extracts code chunks with AST-based semantic understanding.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Set, Optional
import tree_sitter_typescript as ts_typescript
import tree_sitter_javascript as ts_javascript
from tree_sitter import Language, Parser, Node


@dataclass
class TypeScriptChunk:
    """Represents a semantically meaningful chunk of TypeScript/JavaScript code."""

    content: str
    chunk_type: str  # 'function', 'class', 'interface', 'type', 'component'
    name: str
    start_line: int
    end_line: int
    file_path: str
    language: str  # 'typescript' or 'javascript'

    # TypeScript-specific
    module_path: Optional[str] = None  # npm package name
    class_name: Optional[str] = None  # Parent class name (for methods)
    imports: List[str] = field(default_factory=list)
    exports: List[str] = field(default_factory=list)
    type_parameters: List[str] = field(default_factory=list)
    decorators: List[str] = field(default_factory=list)

    # Relationships
    calls: Set[str] = field(default_factory=set)
    extends: Set[str] = field(default_factory=set)
    implements: Set[str] = field(default_factory=set)
    uses_types: Set[str] = field(default_factory=set)

    # WebXR/ECS patterns
    ecs_component: bool = False
    ecs_system: bool = False
    webxr_api_usage: Set[str] = field(default_factory=set)
    three_js_usage: Set[str] = field(default_factory=set)

    # Semantic labels
    semantic_labels: Set[str] = field(default_factory=set)


class TypeScriptParser:
    """Parser for TypeScript and JavaScript files using tree-sitter."""

    def __init__(self):
        """Initialize tree-sitter parsers for TypeScript and JavaScript."""
        # Initialize TypeScript parser
        self.ts_language = Language(ts_typescript.language_typescript())
        self.ts_parser = Parser(self.ts_language)

        # Initialize JavaScript parser
        self.js_language = Language(ts_javascript.language())
        self.js_parser = Parser(self.js_language)

        print("✅ TypeScript/JavaScript parsers initialized")

    def parse_file(self, file_path: str) -> List[TypeScriptChunk]:
        """
        Parse a TypeScript or JavaScript file and extract code chunks.

        Args:
            file_path: Path to the .ts or .js file

        Returns:
            List of TypeScriptChunk objects
        """
        path = Path(file_path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        # Read source code
        with open(file_path, 'rb') as f:
            source_code = f.read()

        # Determine language and parser
        if path.suffix == '.ts' or path.suffix == '.tsx':
            language = 'typescript'
            parser = self.ts_parser
        elif path.suffix == '.js' or path.suffix == '.jsx':
            language = 'javascript'
            parser = self.js_parser
        else:
            raise ValueError(f"Unsupported file extension: {path.suffix}")

        # Parse the file
        tree = parser.parse(source_code)
        root_node = tree.root_node

        # Extract chunks
        chunks = []

        # Extract imports
        imports = self._extract_imports(root_node, source_code)

        # Extract exports
        exports = self._extract_exports(root_node, source_code)

        # Extract classes
        for class_node in self._find_nodes_by_type(root_node, 'class_declaration'):
            chunk = self._parse_class(class_node, source_code, file_path, language, imports)
            chunks.append(chunk)

        # Extract functions (top-level)
        for func_node in self._find_top_level_functions(root_node):
            chunk = self._parse_function(func_node, source_code, file_path, language, imports)
            chunks.append(chunk)

        # Extract interfaces
        for interface_node in self._find_nodes_by_type(root_node, 'interface_declaration'):
            chunk = self._parse_interface(interface_node, source_code, file_path, language)
            chunks.append(chunk)

        # Extract type aliases
        for type_node in self._find_nodes_by_type(root_node, 'type_alias_declaration'):
            chunk = self._parse_type_alias(type_node, source_code, file_path, language)
            chunks.append(chunk)

        # Extract ECS components/systems created with createComponent/createSystem
        ecs_chunks = self._extract_ecs_factory_patterns(root_node, source_code, file_path, language, imports)
        chunks.extend(ecs_chunks)

        return chunks

    def _extract_imports(self, root_node: Node, source_code: bytes) -> List[str]:
        """Extract all import statements."""
        imports = []

        for import_node in self._find_nodes_by_type(root_node, 'import_statement'):
            import_text = self._get_node_text(import_node, source_code)
            imports.append(import_text)

        return imports

    def _extract_exports(self, root_node: Node, source_code: bytes) -> List[str]:
        """Extract all export statements."""
        exports = []

        for export_node in self._find_nodes_by_type(root_node, 'export_statement'):
            export_text = self._get_node_text(export_node, source_code)
            exports.append(export_text)

        return exports

    def _parse_class(self, class_node: Node, source_code: bytes, file_path: str,
                     language: str, imports: List[str]) -> TypeScriptChunk:
        """Parse a class declaration."""
        # Get class name
        name_node = class_node.child_by_field_name('name')
        class_name = self._get_node_text(name_node, source_code) if name_node else 'UnknownClass'

        # Get class content
        content = self._get_node_text(class_node, source_code)

        # Create chunk
        chunk = TypeScriptChunk(
            content=content,
            chunk_type='class',
            name=class_name,
            start_line=class_node.start_point[0] + 1,
            end_line=class_node.end_point[0] + 1,
            file_path=file_path,
            language=language,
            imports=imports.copy()
        )

        # Extract inheritance - find class_heritage node
        heritage_nodes = self._find_nodes_by_type(class_node, 'class_heritage')
        for heritage in heritage_nodes:
            # Extract extends clauses
            for extends_node in self._find_nodes_by_type(heritage, 'extends_clause'):
                # Get the base class being extended
                # For simple cases: class Foo extends Bar
                # For complex cases: class Foo extends createSystem(...) - extract "createSystem"
                for child in extends_node.children:
                    if child.type in ['identifier', 'type_identifier']:
                        parent_class = self._get_node_text(child, source_code)
                        chunk.extends.add(parent_class)
                    elif child.type == 'call_expression':
                        # For call expressions, get the function being called
                        func_node = child.child_by_field_name('function')
                        if func_node:
                            func_name = self._get_node_text(func_node, source_code)
                            chunk.extends.add(func_name)
                    elif child.type == 'member_expression':
                        # For member expressions like Three.Group, get the full expression
                        member_text = self._get_node_text(child, source_code)
                        chunk.extends.add(member_text)

            # Extract implements clauses
            for implements_node in self._find_nodes_by_type(heritage, 'implements_clause'):
                # Get all type identifiers
                for type_node in self._find_nodes_by_type(implements_node, 'type_identifier'):
                    interface = self._get_node_text(type_node, source_code)
                    chunk.implements.add(interface)

        # Detect ECS patterns
        self._detect_ecs_patterns(chunk)

        # Detect WebXR API usage
        self._detect_webxr_patterns(chunk)

        return chunk

    def _parse_function(self, func_node: Node, source_code: bytes, file_path: str,
                       language: str, imports: List[str]) -> TypeScriptChunk:
        """Parse a function declaration."""
        # Get function name
        name_node = func_node.child_by_field_name('name')
        func_name = self._get_node_text(name_node, source_code) if name_node else 'anonymous'

        # Get function content
        content = self._get_node_text(func_node, source_code)

        # Create chunk
        chunk = TypeScriptChunk(
            content=content,
            chunk_type='function',
            name=func_name,
            start_line=func_node.start_point[0] + 1,
            end_line=func_node.end_point[0] + 1,
            file_path=file_path,
            language=language,
            imports=imports.copy()
        )

        # Extract function calls
        self._extract_function_calls(func_node, source_code, chunk)

        # Detect WebXR API usage
        self._detect_webxr_patterns(chunk)

        return chunk

    def _parse_interface(self, interface_node: Node, source_code: bytes,
                        file_path: str, language: str) -> TypeScriptChunk:
        """Parse an interface declaration."""
        # Get interface name
        name_node = interface_node.child_by_field_name('name')
        interface_name = self._get_node_text(name_node, source_code) if name_node else 'UnknownInterface'

        # Get interface content
        content = self._get_node_text(interface_node, source_code)

        chunk = TypeScriptChunk(
            content=content,
            chunk_type='interface',
            name=interface_name,
            start_line=interface_node.start_point[0] + 1,
            end_line=interface_node.end_point[0] + 1,
            file_path=file_path,
            language=language
        )

        # Extract interface extension (interfaces can extend other interfaces)
        heritage_nodes = self._find_nodes_by_type(interface_node, 'extends_type_clause')
        for heritage in heritage_nodes:
            # Get all type identifiers being extended
            for type_node in self._find_nodes_by_type(heritage, 'type_identifier'):
                parent_interface = self._get_node_text(type_node, source_code)
                chunk.extends.add(parent_interface)

        return chunk

    def _parse_type_alias(self, type_node: Node, source_code: bytes,
                         file_path: str, language: str) -> TypeScriptChunk:
        """Parse a type alias declaration."""
        # Get type name
        name_node = type_node.child_by_field_name('name')
        type_name = self._get_node_text(name_node, source_code) if name_node else 'UnknownType'

        # Get type content
        content = self._get_node_text(type_node, source_code)

        chunk = TypeScriptChunk(
            content=content,
            chunk_type='type',
            name=type_name,
            start_line=type_node.start_point[0] + 1,
            end_line=type_node.end_point[0] + 1,
            file_path=file_path,
            language=language
        )

        return chunk

    def _extract_ecs_factory_patterns(self, root_node: Node, source_code: bytes,
                                       file_path: str, language: str, imports: List[str]) -> List[TypeScriptChunk]:
        """
        Extract ECS components/systems created with createComponent() or createSystem() factory functions.

        Pattern: export const ComponentName = createComponent(...)
        """
        chunks = []

        # Find all lexical declarations (const, let, var)
        for var_statement in self._find_nodes_by_type(root_node, 'lexical_declaration'):
            # Check if it's exported
            for declarator in self._find_nodes_by_type(var_statement, 'variable_declarator'):
                # Get variable name
                name_node = declarator.child_by_field_name('name')
                if not name_node:
                    continue
                var_name = self._get_node_text(name_node, source_code)

                # Get initializer (the value being assigned)
                value_node = declarator.child_by_field_name('value')
                if not value_node or value_node.type != 'call_expression':
                    continue

                # Get the function being called
                func_node = value_node.child_by_field_name('function')
                if not func_node:
                    continue
                func_name = self._get_node_text(func_node, source_code)

                # Check if it's createComponent or createSystem
                is_component = 'createComponent' in func_name
                is_system = 'createSystem' in func_name

                if not (is_component or is_system):
                    continue

                # Get the full variable declaration including comments
                # Walk up to get the lexical_declaration or export_statement
                parent = var_statement.parent
                content_node = var_statement

                # If it's exported, include the export statement
                if parent and parent.type == 'export_statement':
                    content_node = parent

                content = self._get_node_text(content_node, source_code)

                # Create chunk
                chunk = TypeScriptChunk(
                    content=content,
                    chunk_type='component' if is_component else 'system',
                    name=var_name,
                    start_line=content_node.start_point[0] + 1,
                    end_line=content_node.end_point[0] + 1,
                    file_path=file_path,
                    language=language,
                    imports=imports.copy()
                )

                # Mark as ECS component/system
                if is_component:
                    chunk.ecs_component = True
                    chunk.semantic_labels.add('ecs_component')
                    chunk.extends.add('Component')
                else:
                    chunk.ecs_system = True
                    chunk.semantic_labels.add('ecs_system')
                    chunk.extends.add('System')

                # Extract calls from the value expression
                self._extract_function_calls(value_node, source_code, chunk)

                # Detect WebXR API usage
                self._detect_webxr_patterns(chunk)

                chunks.append(chunk)

        return chunks

    def _extract_function_calls(self, node: Node, source_code: bytes, chunk: TypeScriptChunk):
        """Extract function calls from a node."""
        for call_node in self._find_nodes_by_type(node, 'call_expression'):
            func_node = call_node.child_by_field_name('function')
            if func_node:
                func_name = self._get_node_text(func_node, source_code)
                chunk.calls.add(func_name)

    def _detect_ecs_patterns(self, chunk: TypeScriptChunk):
        """Detect ECS component/system patterns."""
        content = chunk.content.lower()

        # Component detection
        if 'implements component' in content or 'extends componentbase' in content:
            chunk.ecs_component = True
            chunk.semantic_labels.add('ecs_component')

        # System detection - check both content patterns and extends metadata
        if ('extends system' in content or
            'implements isystem' in content or
            'createSystem' in chunk.extends):  # Check if extends createSystem()
            chunk.ecs_system = True
            chunk.semantic_labels.add('ecs_system')

        # Specific component types
        if 'transform' in chunk.name.lower():
            chunk.semantic_labels.add('transform_component')
        elif 'physics' in chunk.name.lower():
            chunk.semantic_labels.add('physics_component')

    def _detect_webxr_patterns(self, chunk: TypeScriptChunk):
        """Detect WebXR API usage patterns."""
        # Common WebXR APIs
        webxr_apis = [
            'XRSession', 'XRFrame', 'XRReferenceSpace', 'XRViewerPose',
            'XRInputSource', 'XRHand', 'requestSession', 'requestAnimationFrame'
        ]

        for api in webxr_apis:
            if api in chunk.content:
                chunk.webxr_api_usage.add(api)
                chunk.semantic_labels.add('webxr_api')

        # Three.js patterns
        threejs_patterns = ['THREE.', 'Scene', 'Mesh', 'Material', 'Geometry']
        for pattern in threejs_patterns:
            if pattern in chunk.content:
                chunk.three_js_usage.add(pattern)
                chunk.semantic_labels.add('threejs_usage')

    def _find_nodes_by_type(self, node: Node, node_type: str) -> List[Node]:
        """Recursively find all nodes of a specific type."""
        nodes = []

        if node.type == node_type:
            nodes.append(node)

        for child in node.children:
            nodes.extend(self._find_nodes_by_type(child, node_type))

        return nodes

    def _find_top_level_functions(self, root_node: Node) -> List[Node]:
        """Find top-level function declarations (not inside classes)."""
        functions = []

        for child in root_node.children:
            if child.type in ['function_declaration', 'function', 'export_statement']:
                # Check if it contains a function
                if child.type == 'export_statement':
                    for subchild in child.children:
                        if subchild.type == 'function_declaration':
                            functions.append(subchild)
                else:
                    functions.append(child)

        return functions

    def _get_node_text(self, node: Node, source_code: bytes) -> str:
        """Extract text content from an AST node."""
        if node is None:
            return ""
        return source_code[node.start_byte:node.end_byte].decode('utf-8')


def main():
    """Test the TypeScript parser."""
    parser = TypeScriptParser()

    # Test with a sample file (you can replace with actual SDK file)
    test_file = "/Users/felixz/Projects/llm-knowledge/immersive-web-sdk/packages/core/src/index.ts"

    try:
        chunks = parser.parse_file(test_file)
        print(f"\n✅ Parsed {len(chunks)} chunks from {test_file}\n")

        for i, chunk in enumerate(chunks[:5], 1):  # Show first 5
            print(f"{i}. {chunk.chunk_type.upper()}: {chunk.name}")
            print(f"   Lines: {chunk.start_line}-{chunk.end_line}")
            print(f"   Labels: {chunk.semantic_labels}")
            if chunk.extends:
                print(f"   Extends: {chunk.extends}")
            if chunk.implements:
                print(f"   Implements: {chunk.implements}")
            print()

    except FileNotFoundError:
        print(f"⚠️  Test file not found. Please update the test_file path.")
        print("   Usage: python -m ingestion.parsers.typescript_parser")


if __name__ == "__main__":
    main()
