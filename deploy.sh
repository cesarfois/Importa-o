#!/bin/bash
# Script de deploy automatizado para o processo de importação

echo "==============================================="
echo "🚀 Iniciando atualização automática do App..."
echo "==============================================="

# 1. Atualizar repositório Git local
echo "📦 Passo 1: Buscando atualizações no GitHub..."
git fetch origin
git reset --hard origin/main

# 2. Reconstruir a imagem Docker
echo "🛠️ Passo 2: Reconstruindo a imagem Docker (sem cache)..."
docker compose build --no-cache rcsvision

# 3. Reiniciar os contêineres
echo "🔄 Passo 3: Reiniciando o contêiner..."
docker compose up -d

echo "==============================================="
echo "✅ Atualização concluída com sucesso!"
echo "==============================================="
