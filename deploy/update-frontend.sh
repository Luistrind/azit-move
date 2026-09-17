#!/usr/bin/env bash
# DESATIVADO em 17/09 (plano de ambientes): a produção NÃO é mais publicada a
# partir da main. Fluxo novo:
#   homologação:  cd /opt/azit && git pull && bash deploy/deploy-hml.sh
#   produção:     cd /opt/azit && git pull && bash deploy/deploy-prod.sh vX.Y.Z
echo "✘ update-frontend.sh foi aposentado — a produção agora sobe só por release."
echo "  Homologação:  bash deploy/deploy-hml.sh"
echo "  Produção:     bash deploy/deploy-prod.sh <tag>   (tags: git tag --sort=-creatordate | head)"
exit 1
