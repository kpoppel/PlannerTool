# Contributing Guidelines

Thank you for your interest in contributing to this project! To ensure a high-quality, maintainable, and collaborative codebase, please follow these guidelines and best practices:

## Getting Started
- **Read `LICENSE`** to understand licensing terms.
- **Read `PROJECT_CONTEXT.md` and `ARCHITECTURE.md`** to understand the project’s goals, structure, and design principles.
- **Fork the repository** and create a feature branch for your changes.
- **Follow the installation guide from `README.md`** and set up your environment.

## Code Style & Structure
- **Python:**
  - Follow PEP8 style guidelines.
  - Use OOP and modular design; keep functions and classes focused and reusable.
  - Place new modules in the appropriate directory (e.g., `planner_lib/<module>`).
- **JavaScript/HTML/CSS:**
  - Use clear, modular code and separate UI logic from API interaction.
  - Prefer ES6+ syntax and Lit components for advanced UI features.
- **Documentation:**
  - Update or add docstrings and comments for all public classes, functions, and modules.
  - Keep documentation (`ARCHITECTURE.md`, `PRODUCT.md`) up to date with major changes.

## Testing
Generally aim for leaving at least 80% unit test coverage. Help improve coverage.
- **Python:**
  - Write unit tests for new features and bug fixes in the `tests/` directory.
  - Ensure all tests pass before submitting a pull request.
- **JavaScript:**
  - Add or update tests in the `tests/` directory as needed.

## Pull Requests
- **Describe your changes** clearly in the PR description.
- **Reference related issues** (if any) and link to relevant documentation.
- **Keep PRs focused**: One feature or fix per pull request.
- **Request a review** from a maintainer before merging.

## Best Practices
- Follow separation of concerns and single responsibility principles.
- Use dependency inversion for extensibility and testability.
- Validate inputs and handle errors gracefully in all code.
- Keep interfaces open for extension, closed for modification.
- Update tests and documentation with every significant change.

## Code of Conduct
- Be respectful and collaborative.
- Provide constructive feedback and help others improve.

---
By following these guidelines, you help keep the project robust, maintainable, and welcoming to all contributors. Happy coding!
