# IWSDK-RAG MCP Server - Comprehensive Test Suite

**Version:** 1.0  
**Last Updated:** 2025-11-16  
**Purpose:** This document provides a complete, systematic test suite for evaluating the iwsdk-rag MCP server. It can be used by anyone without prior context to validate all functionality.

---

## 📋 Overview

The **iwsdk-rag MCP server** is a Model Context Protocol server that provides semantic search and code navigation capabilities for the Immersive Web SDK (IWSDK) codebase. It indexes TypeScript/JavaScript code across three sources:
- **iwsdk** - Main Immersive Web SDK code
- **elics** - ECS (Entity Component System) library
- **deps** - Node.js dependencies

---

## 🎯 Testing Objectives

This test suite validates:
1. Semantic search capabilities
2. Structural code navigation (relationships)
3. API reference lookups
4. File content retrieval
5. ECS component/system listing
6. Dependency tracking
7. Usage pattern discovery
8. Edge cases and error handling

---

## 🛠️ Available Tools

The MCP server provides 8 tools:

| Tool Name | Purpose | Key Parameters |
|-----------|---------|----------------|
| `search_code` | Semantic search across codebase | `query`, `limit`, `min_score`, `source` |
| `find_by_relationship` | Find code by structural relationships | `type`, `target`, `limit` |
| `get_api_reference` | Quick API lookup by name | `name`, `type`, `source` |
| `get_file_content` | Read file contents with line ranges | `file_path`, `source`, `start_line`, `end_line` |
| `list_ecs_components` | List all ECS components | `limit`, `source` |
| `list_ecs_systems` | List all ECS systems | `limit`, `source` |
| `find_dependents` | Find what depends on an API | `api_name`, `dependency_type`, `limit` |
| `find_usage_examples` | Find real-world usage examples | `api_name`, `limit` |

---

## 📝 Test Cases

### **Test 1: Basic Semantic Search**

**Objective:** Verify that semantic search finds relevant code based on natural language queries.

**Tool:** `search_code`

**Test Steps:**
```
Call: search_code
Parameters:
  query: "how to handle XR controller input events"
  limit: 5
```

**Expected Results:**
- Should return 5 relevant code chunks
- Results should include classes/functions related to XR input handling
- Common results: `XRInputManager`, `XRInputSourceEvent`, `XRInputSourceEventMap`
- Each result should have:
  - A relevance score (0.0-1.0)
  - Type annotation (class, function, interface, etc.)
  - Source (iwsdk, elics, or deps)
  - File path
  - Code snippet
- Results should be ranked by relevance score (highest first)

**Pass Criteria:**
- ✅ Returns exactly 5 results
- ✅ All results have scores above 0.4
- ✅ Top result is clearly relevant to input handling
- ✅ Results include proper metadata (type, source, file)

---

### **Test 2: Relationship Search - Find Systems**

**Objective:** Verify that the server can find all classes that extend a specific base class.

**Tool:** `find_by_relationship`

**Test Steps:**
```
Call: find_by_relationship
Parameters:
  type: "extends"
  target: "createSystem"
  limit: 10
```

**Expected Results:**
- Should return multiple systems (8-12 typically)
- Common systems found:
  - `GrabSystem`
  - `TransformSystem`
  - `LocomotionSystem`
  - `InputSystem`
  - `PanelUISystem`
  - `ScreenSpaceUISystem`
  - `FollowSystem`
  - `VisibilitySystem`
  - `TeleportSystem`
  - `SlideSystem`
- Each result should include:
  - Pattern annotation: **"Pattern: ECS System"**
  - Full class implementation
  - `Extends: createSystem` annotation

**Pass Criteria:**
- ✅ Returns 8+ systems
- ✅ All results show "Pattern: ECS System"
- ✅ All results show "Extends: createSystem"
- ✅ Results include actual class implementations, not just declarations

---

### **Test 3: API Reference Lookup - Multiple Matches**

**Objective:** Verify that API lookup returns all definitions when a name matches multiple entities.

**Tool:** `get_api_reference`

**Test Steps:**
```
Call: get_api_reference
Parameters:
  name: "Transform"
```

**Expected Results:**
- Should return multiple matches (20-30 typically)
- Should include at minimum:
  - `Transform` component from iwsdk (with full schema)
  - `TransformSystem` from iwsdk (with full class code)
  - Various Transform-related types from deps
- The Transform component should show:
  - **Pattern: ECS Component**
  - Full `createComponent` call with schema
  - Schema fields: `position`, `orientation`, `scale`, `parent`
- The TransformSystem should show:
  - **Pattern: ECS System**
  - Full class extending `createSystem`
  - Query definitions
  - init() and update() methods

**Pass Criteria:**
- ✅ Returns 15+ matches
- ✅ Includes Transform component with "Pattern: ECS Component"
- ✅ Includes TransformSystem with "Pattern: ECS System"
- ✅ Shows complete component schema
- ✅ Shows complete system implementation

---

### **Test 4: File Content Retrieval with Line Ranges**

**Objective:** Verify that the server can retrieve specific line ranges from files.

**Tool:** `get_file_content`

**Test Steps:**
```
Call: get_file_content
Parameters:
  file_path: "src/xr-input-manager.ts"
  source: "iwsdk"
  start_line: 60
  end_line: 100
```

**Expected Results:**
- Should return exactly lines 60-100 from the file
- Should include:
  - File path confirmation
  - Source confirmation (iwsdk)
  - Line range confirmation (60-100)
  - TypeScript code containing XRInputManager class definition
  - Class properties like `xrOrigin`, `multiPointers`, `gamepads`

**Pass Criteria:**
- ✅ Returns exactly 41 lines (60 to 100 inclusive)
- ✅ Content matches XRInputManager class structure
- ✅ No truncation or missing lines
- ✅ Valid TypeScript syntax

---

### **Test 5: List All ECS Components**

**Objective:** Verify that the server can enumerate all ECS components in the codebase.

**Tool:** `list_ecs_components`

**Test Steps:**
```
Call: list_ecs_components
Parameters:
  limit: 25
```

**Expected Results:**
- Should return 20-25 components
- Common components to expect:
  - Transform
  - Visibility
  - PanelUI
  - ScreenSpace
  - Follower
  - Interactable
  - Hovered
  - Pressed
  - OneHandGrabbable
  - TwoHandsGrabbable
  - DistanceGrabbable
  - LocomotionEnvironment
  - AudioSource
  - CameraSource
  - XRPlane
  - XRMesh
  - XRAnchor
- Each entry should include:
  - Component name
  - Source (typically iwsdk)
  - File path
  - Extends: Component

**Pass Criteria:**
- ✅ Returns 18+ components
- ✅ Includes Transform, Visibility, PanelUI
- ✅ All entries show source and file path
- ✅ All entries show "Extends: Component"

---

### **Test 6: List All ECS Systems**

**Objective:** Verify that the server can enumerate all ECS systems in the codebase.

**Tool:** `list_ecs_systems`

**Test Steps:**
```
Call: list_ecs_systems
Parameters:
  limit: 25
```

**Expected Results:**
- Should return 15-20 systems
- Common systems to expect:
  - TransformSystem
  - VisibilitySystem
  - InputSystem
  - GrabSystem
  - LocomotionSystem
  - TeleportSystem
  - SlideSystem
  - TurnSystem
  - PanelUISystem
  - ScreenSpaceUISystem
  - FollowSystem
  - AudioSystem
  - CameraSystem
  - SceneUnderstandingSystem
  - PhysicsSystem
  - LevelSystem
  - EnvironmentSystem
- Each entry should include:
  - System name
  - Source (typically iwsdk)
  - File path
  - Extends: createSystem

**Pass Criteria:**
- ✅ Returns 15+ systems
- ✅ Includes TransformSystem, InputSystem, GrabSystem
- ✅ Includes VisibilitySystem (this is a good indicator of completeness)
- ✅ All entries show source and file path
- ✅ All entries show "Extends: createSystem"

---

### **Test 7: Reverse Dependency Lookup**

**Objective:** Verify that the server can find all code that depends on a specific API.

**Tool:** `find_dependents`

**Test Steps:**
```
Call: find_dependents
Parameters:
  api_name: "createComponent"
  dependency_type: "any"
  limit: 5
```

**Expected Results:**
- Should return 5 code chunks that use `createComponent`
- Results should include actual component definitions
- Common results:
  - Transform component
  - PanelUI component
  - Grabbable components (OneHand, TwoHands, Distance)
  - Handle component
- Each result should show:
  - **Pattern: ECS Component** annotation
  - Full `createComponent(...)` call
  - Complete component schema
  - Component description string

**Pass Criteria:**
- ✅ Returns exactly 5 results
- ✅ All results show full component definitions
- ✅ All results include "Pattern: ECS Component"
- ✅ All results show the complete `createComponent` call with schema

---

### **Test 8: Find Usage Examples**

**Objective:** Verify that the server can find real-world usage patterns of an API.

**Tool:** `find_usage_examples`

**Test Steps:**
```
Call: find_usage_examples
Parameters:
  api_name: "PanelUI"
  limit: 3
```

**Expected Results:**
- Should return 3 code chunks showing PanelUI usage
- Results should prioritize actual usage (not just type definitions)
- Common results:
  - ScreenSpaceUISystem (queries PanelUI)
  - EntityCreator (creates PanelUI components)
  - World initialization code (registers PanelUI)
- Each result should:
  - Show real code that imports/uses PanelUI
  - Include Pattern annotations if applicable
  - Show context around the usage
- Results are ranked by relevance (0.0-1.0 score)

**Pass Criteria:**
- ✅ Returns exactly 3 results
- ✅ Results show actual code using PanelUI (not just definitions)
- ✅ Top result has relevance score > 0.7
- ✅ Results include meaningful context

---

### **Test 9: Find Implementations/Extensions**

**Objective:** Verify that the server can find classes that implement or extend interfaces/classes.

**Tool:** `find_by_relationship`

**Test Steps:**
```
Call: find_by_relationship
Parameters:
  type: "extends"
  target: "XRInputVisualAdapter"
  limit: 5
```

**Expected Results:**
- Should return 2 classes
- Expected results:
  - `XRHandVisualAdapter`
  - `XRControllerVisualAdapter`
- Each result should:
  - Show "Extends: XRInputVisualAdapter"
  - Include full class implementation
  - Show constructor and methods
  - Include connect/disconnect/update methods

**Pass Criteria:**
- ✅ Returns exactly 2 results
- ✅ Includes XRHandVisualAdapter and XRControllerVisualAdapter
- ✅ Both show "Extends: XRInputVisualAdapter"
- ✅ Both include complete class implementations

---

### **Test 10: Find Function Calls**

**Objective:** Verify that the server can find code that calls specific functions.

**Tool:** `find_by_relationship`

**Test Steps:**
```
Call: find_by_relationship
Parameters:
  type: "calls"
  target: "createTransformEntity"
  limit: 5
```

**Expected Results:**
- Should return 2-5 code chunks that call `createTransformEntity`
- Common results:
  - World initialization code
  - System implementations
  - Entity creator code
- Each result should show:
  - Actual function call: `world.createTransformEntity(...)` or `this.createTransformEntity(...)`
  - Context around the call
  - Parameters being passed

**Pass Criteria:**
- ✅ Returns 2+ results
- ✅ All results show actual calls to createTransformEntity
- ✅ Results include meaningful context
- ✅ Function calls are clearly visible in the code

---

### **Test 11: WebXR API Usage Tracking** ⚠️

**Objective:** Verify that the server can track usage of WebXR APIs.

**Tool:** `find_by_relationship`

**Test Steps:**
```
Call: find_by_relationship
Parameters:
  type: "uses_webxr_api"
  target: "XRSession"
  limit: 10
```

**Expected Results:**
- **KNOWN ISSUE:** This currently returns no results
- Theoretically should find code using XRSession API
- Expected (but not found):
  - XRInputManager using XRSession
  - Systems accessing session.inputSources
  - Code handling XR session lifecycle

**Pass Criteria:**
- ⚠️ **Currently Fails** - Returns "No code found"
- This is a known limitation of the current indexing pipeline
- WebXR API usage tracking needs investigation

**Notes:**
- This test documents a known gap in the MCP server
- The feature exists but doesn't currently work as expected
- XRSession, XRFrame, XRInputSource tracking is not functional

---

### **Test 12: Score Filtering with min_score**

**Objective:** Verify that the min_score parameter correctly filters results.

**Tool:** `search_code`

**Test Steps (Part A - High Threshold):**
```
Call: search_code
Parameters:
  query: "locomotion teleport system"
  limit: 10
  min_score: 0.5
```

**Expected Results (Part A):**
- Should return 1-2 results (high-quality matches only)
- Top result should be TeleportSystem with score > 0.5
- Low-relevance results should be filtered out

**Test Steps (Part B - Low Threshold):**
```
Call: search_code
Parameters:
  query: "locomotion teleport system"
  limit: 10
  min_score: 0.3
```

**Expected Results (Part B):**
- Should return 5+ results
- Should include:
  - TeleportSystem (score ~0.54)
  - LocomotionSystem (score ~0.47)
  - SlideSystem (score ~0.45)
  - Additional locomotion-related code
- All results should have scores ≥ 0.3

**Pass Criteria:**
- ✅ Part A returns fewer results than Part B
- ✅ Part A: 1-2 results with scores > 0.5
- ✅ Part B: 5+ results with scores > 0.3
- ✅ All returned results respect the min_score threshold
- ✅ Higher threshold produces higher-quality results

---

### **Test 13: Source Filtering**

**Objective:** Verify that searches can be filtered by source (iwsdk, elics, deps).

**Tool:** `search_code`

**Test Steps:**
```
Call: search_code
Parameters:
  query: "entity component system"
  limit: 5
  source: ["iwsdk"]
```

**Expected Results:**
- Should return only results from iwsdk source
- Should NOT include results from elics or deps
- Results should be relevant to ECS concepts in IWSDK

**Pass Criteria:**
- ✅ Returns 5 results
- ✅ All results show source: iwsdk
- ✅ No results from elics or deps

---

### **Test 14: Empty/Invalid Query Handling**

**Objective:** Verify that the server handles edge cases gracefully.

**Test Steps:**

**Part A - Non-existent API:**
```
Call: get_api_reference
Parameters:
  name: "NonExistentComponent123"
```

**Expected Results (Part A):**
- Should return: "No API found with name: NonExistentComponent123"
- Should NOT throw an error
- Should handle gracefully

**Part B - Empty search:**
```
Call: search_code
Parameters:
  query: ""
  limit: 5
```

**Expected Results (Part B):**
- Should either return no results or handle gracefully
- Should NOT crash the server

**Pass Criteria:**
- ✅ Server handles non-existent lookups gracefully
- ✅ Server doesn't crash on edge cases
- ✅ Returns appropriate error/empty messages

---

### **Test 15: Type-Specific API Lookup**

**Objective:** Verify that API lookups can be filtered by code type.

**Tool:** `get_api_reference`

**Test Steps:**
```
Call: get_api_reference
Parameters:
  name: "Transform"
  type: "component"
```

**Expected Results:**
- Should return only component definitions named "Transform"
- Should filter out TransformSystem, transform functions, etc.
- Should return Transform component from iwsdk

**Pass Criteria:**
- ✅ Returns only component-type results
- ✅ Does not include TransformSystem or other types
- ✅ Successfully filters by type parameter

---

## 📊 Test Results Template

Use this template to record test results:

```markdown
## Test Execution Results

**Date:** [YYYY-MM-DD]
**Tester:** [Name]
**MCP Server Version:** [Version if known]

| Test # | Test Name | Status | Notes |
|--------|-----------|--------|-------|
| 1 | Basic Semantic Search | ⬜ | |
| 2 | Relationship Search - Find Systems | ⬜ | |
| 3 | API Reference Lookup | ⬜ | |
| 4 | File Content Retrieval | ⬜ | |
| 5 | List ECS Components | ⬜ | |
| 6 | List ECS Systems | ⬜ | |
| 7 | Reverse Dependency Lookup | ⬜ | |
| 8 | Find Usage Examples | ⬜ | |
| 9 | Find Implementations | ⬜ | |
| 10 | Find Function Calls | ⬜ | |
| 11 | WebXR API Tracking | ⬜ | Known Issue ⚠️ |
| 12 | Score Filtering | ⬜ | |
| 13 | Source Filtering | ⬜ | |
| 14 | Edge Case Handling | ⬜ | |
| 15 | Type-Specific Lookup | ⬜ | |

**Legend:** ✅ Pass | ❌ Fail | ⚠️ Known Issue | ⬜ Not Tested

**Summary:**
- Tests Passed: __/15
- Tests Failed: __/15
- Known Issues: 1/15
```

---

## 🎯 Success Criteria

For the MCP server to be considered **fully functional**, it should:

1. **Pass 13 out of 15 tests** (Tests 1-10, 12-15)
2. **Document Test 11 as a known limitation** (WebXR API tracking)
3. **Core Features Working:**
   - ✅ Semantic search with relevance ranking
   - ✅ Relationship-based code navigation
   - ✅ API reference lookups with type filtering
   - ✅ File content retrieval with line ranges
   - ✅ ECS component/system enumeration
   - ✅ Reverse dependency tracking
   - ✅ Usage pattern discovery
   - ✅ Pattern detection (ECS Component/System)

---

## 🐛 Known Issues & Limitations

### Issue #1: WebXR API Usage Tracking
- **Test:** Test 11
- **Status:** Not Working
- **Description:** The `uses_webxr_api` relationship type does not find XRSession, XRFrame, or XRInputSource usage
- **Impact:** Cannot track WebXR API usage patterns
- **Workaround:** Use semantic search with queries like "XRSession" or "XRFrame"
- **Investigation Needed:** Indexing pipeline may not be capturing WebXR API references

---

## 📖 Additional Notes

### Pattern Detection
The MCP server automatically detects and annotates certain code patterns:
- **"Pattern: ECS Component"** - Code that uses `createComponent`
- **"Pattern: ECS System"** - Code that extends `createSystem`

These annotations help identify architectural patterns in the codebase.

### Relevance Scores
Search results include relevance scores (0.0-1.0):
- **0.7-1.0:** Highly relevant, direct matches
- **0.5-0.7:** Moderately relevant, related concepts
- **0.3-0.5:** Loosely relevant, tangential matches
- **< 0.3:** Low relevance, often filtered out

### Source Types
- **iwsdk:** Main Immersive Web SDK code (TypeScript)
- **elics:** Entity Component System library (TypeScript)
- **deps:** Third-party dependencies (TypeScript definitions)

---

## 🚀 Quick Start for Testing

To test this MCP server in a new chat session:

1. **Copy this entire document** into your context
2. **Start with Test 1** - verify basic functionality
3. **Run Tests 2-6** - validate core features
4. **Run Tests 7-10** - validate advanced features
5. **Run Tests 11-15** - check edge cases and filters
6. **Document Test 11 as a known issue** ⚠️
7. **Fill out the Test Results Template**

**Example Test Execution:**
```
I'm going to test the iwsdk-rag MCP server. Let me start with Test 1.

[Call search_code with the parameters from Test 1]

Based on the results, I'll evaluate:
- Did it return 5 results?
- Do the results have scores above 0.4?
- Is the top result relevant to XR input handling?
- Do results include proper metadata?

[Record results and move to Test 2]
```

---

## 📝 Version History

- **v1.0** (2025-11-16) - Initial test suite creation
  - 15 comprehensive tests
  - Known issue: WebXR API tracking (Test 11)
  - Expected success rate: 13/15 (87%)

---

## 📧 Feedback & Issues

When reporting issues or unexpected behavior:
1. Include the test number
2. Provide the exact tool call parameters used
3. Include the actual vs expected results
4. Note any error messages
5. Include your environment details (if relevant)

---

**End of Test Suite Documentation**
