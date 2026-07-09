<p align="center">
  <img src="https://assets.ubuntu.com/v1/82818827-CoF_white.svg" alt="Ubuntu" width="80"/>
</p>

<h1 align="center">Reference SDKs</h1>

<p align="center">
  <em>A curated collection of workshop components built with <a href="https://github.com/canonical/sdkcraft">SDKcraft</a> — composable, multi-base, multi-architecture.</em>
</p>

<p align="center">
  <a href="#ai-agents--coding-assistants"><img src="https://img.shields.io/badge/-AI%20Agents-blueviolet?style=flat-square" alt="AI Agents"/></a>
  <a href="#languages--runtimes"><img src="https://img.shields.io/badge/-Languages-blue?style=flat-square" alt="Languages"/></a>
  <a href="#gpu--hardware-acceleration"><img src="https://img.shields.io/badge/-GPU%20%26%20HW-green?style=flat-square" alt="GPU"/></a>
  <a href="#ai--ml-model-serving"><img src="https://img.shields.io/badge/-AI%2FML%20Serving-orange?style=flat-square" alt="AI/ML"/></a>
  <a href="#embedded-systems--rtos"><img src="https://img.shields.io/badge/-Embedded-red?style=flat-square" alt="Embedded"/></a>
  <a href="#robotics"><img src="https://img.shields.io/badge/-Robotics-teal?style=flat-square" alt="Robotics"/></a>
  <a href="#developer-tools--infrastructure"><img src="https://img.shields.io/badge/-DevTools-grey?style=flat-square" alt="DevTools"/></a>
</p>

---

## Overview

Each SDK is a **workshop component** — a building block that can be added to a [workshop](https://github.com/canonical/workshop) to set up a specific part of the development environment. Combine multiple SDKs (e.g. uv + CUDA + Ollama) to assemble a complete, tailored workshop with **persistent caches, configurations, and build artifacts** across sessions.

---

## AI Agents & Coding Assistants

| SDK | Description |
|:----|:------------|
| [**Antigravity CLI**](https://github.com/canonical/agy-sdk) | The terminal-first surface to interact with Antigravity agents. |
| [**Claude Code**](https://github.com/canonical/claude-code-sdk) | Anthropic's agentic coding tool for the terminal |
| [**OpenAI Codex**](https://github.com/canonical/codex-sdk) | OpenAI's CLI coding agent |
| [**GitHub Copilot CLI**](https://github.com/canonical/copilot-sdk) | GitHub Copilot for the terminal |
| [**OpenCode**](https://github.com/canonical/opencode-sdk) | Open-source terminal-based AI coding assistant |

---

## Languages & Runtimes

| SDK | Description |
|:----|:------------|
| [**Go**](https://github.com/canonical/go-sdk) | Go programming language toolchain |
| [**Node.js**](https://github.com/canonical/node-sdk) | Node.js LTS runtime with Corepack |
| [**Rust**](https://github.com/canonical/rust-sdk) | Rust toolchain managed via Rustup |
| [**.NET**](https://github.com/canonical/dotnet-sdk) | Microsoft .NET SDK |
| [**Flutter**](https://github.com/canonical/flutter-sdk) | Google's cross-platform UI toolkit |
| [**uv**](https://github.com/canonical/uv-sdk) | Fast Python package and project manager |

---

## GPU & Hardware Acceleration

| SDK | Description |
|:----|:------------|
| [**NVIDIA CUDA Toolkit**](https://github.com/canonical/cuda-toolkit-sdk) | NVIDIA CUDA Toolkit for GPU parallel computing |
| [**AMD ROCm**](https://github.com/canonical/rocm-sdk) | AMD ROCm open GPU compute platform |
| [**Intel OpenVINO**](https://github.com/canonical/openvino-sdk) | Intel OpenVINO toolkit for AI inference |

---

## AI / ML Model Serving

| SDK | Description |
|:----|:------------|
| [**Ollama**](https://github.com/canonical/ollama-sdk) | Local LLM runtime for running open-weight models |
| [**ComfyUI**](https://github.com/canonical/comfy-ui-sdk) | Node-based UI for Stable Diffusion image generation |

---

## Embedded Systems & RTOS

| SDK | Description | Targets |
|:----|:------------|:--------|
| [**Zephyr RTOS**](https://github.com/canonical/zephyr-sdk) | Zephyr RTOS build environment (west, cmake, ninja) | Host `amd64` |
| [**Zephyr SDK NG**](https://github.com/canonical/zephyr-sdk-ng) | Zephyr SDK with bundled cross-compilers | Host `amd64` |

#### Architecture-specific Zephyr Toolchains

| SDK | Target Triple |
|:----|:--------------|
| [**Zephyr x86_64**](https://github.com/canonical/zephyr-amd64-sdk) | `x86_64-zephyr-elf` |
| [**Zephyr ARM (32-bit)**](https://github.com/canonical/zephyr-arm-sdk) | `arm-zephyr-eabi` |
| [**Zephyr AArch64**](https://github.com/canonical/zephyr-arm64-sdk) | `aarch64-zephyr-elf` |
| [**Zephyr RISC-V 64**](https://github.com/canonical/zephyr-riscv64-sdk) | `riscv64-zephyr-elf` |
| [**Zephyr Xtensa ESP32**](https://github.com/canonical/zephyr-xtensa-espressif-esp32-sdk) | `xtensa-espressif_esp32_zephyr-elf` |
| [**Zephyr Xtensa ESP32-S3**](https://github.com/canonical/zephyr-xtensa-espressif-esp32s3-sdk) | `xtensa-espressif_esp32s3_zephyr-elf` |

---

## Robotics

| SDK | Description |
|:----|:------------|
| [**ROS 2**](https://github.com/canonical/ros2-sdk) | ROS 2 robotics development environment |

---

## Developer Tools & Infrastructure

| SDK | Description |
|:----|:------------|
| [**Docker**](https://github.com/canonical/docker-sdk) | Docker container runtime and CLI |
| [**direnv**](https://github.com/canonical/direnv-sdk) | Automatic per-directory environment variable loader |
| [**VS Code Remote**](https://github.com/canonical/vscode-remote-sdk) | SSH server for VS Code Remote Development |
| [**GitHub Actions Runner**](https://github.com/canonical/github-runner-sdk) | Self-hosted GitHub Actions runner |
| [**JupyterLab**](https://github.com/canonical/jupyter-sdk) | Browser-based interactive Python IDE |

---

## Utilities & Templates

| Directory | Purpose |
|:----------|:--------|
| [`template-sdk/`](https://github.com/canonical/template-sdk) | Reference template and best-practice guide for creating new SDKs |
| [`sdkcraft-actions/`](https://github.com/canonical/sdkcraft-actions) | Shared helper scripts used across SDK build and lifecycle hooks |

---

## Project Structure

Each SDK follows a consistent layout:

```
<name>-sdk/
├── sdkcraft.yaml      # Declarative SDK definition (packages, plugs, services)
├── renovate.json      # Automated dependency update configuration
├── VERSION            # Current SDK version (where applicable)
├── README.md          # SDK-specific documentation
├── hooks/             # Lifecycle scripts (install, configure, run, remove)
└── services/          # Systemd service definitions (for daemons like Ollama, JupyterLab)
```

<p align="center">
  <sub>Built with <a href="https://github.com/canonical/sdkcraft">SDKcraft</a> on <a href="https://ubuntu.com">Ubuntu</a></sub>
</p>
