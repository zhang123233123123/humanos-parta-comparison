"""Create fresh local configuration and a private Part A link; never overwrite files."""
from pathlib import Path
import secrets,hashlib
root=Path(__file__).resolve().parents[1]
front=root/'webapp/frontend/.env.local';back=root/'webapp/backend/.env'
if front.exists() or back.exists():raise SystemExit('Configuration already exists; edit it manually rather than replacing credentials.')
token=secrets.token_urlsafe(32);proxy=secrets.token_urlsafe(48);actor='parta_link_'+secrets.token_hex(16)
shared=f'HUMANOS_PARTA_MODE=1\nHUMANOS_PARTA_PROXY_SECRET={proxy}\nHUMANOS_PARTA_LINK_ACTOR={actor}\n'
backend='PORT=8787\nHUMANOS_SIMULATION_MODE=0\nDEEPSEEK_API_KEY=\nDEEPSEEK_BASE_URL=https://llmapi.fiblab.net/v1\nDEEPSEEK_MODEL=deepseek-v4-flash\nDEEPSEEK_TIMEOUT_SECONDS=90\nHUMANOS_PARTA_RESEARCHERS=\n'+shared
frontend='NEXTAUTH_URL=http://localhost:3000\nNEXTAUTH_SECRET='+secrets.token_urlsafe(48)+'\nHUMANOS_BACKEND_URL=http://localhost:8787\nHUMANOS_SIMULATION_MODE=0\nHUMANOS_DEMO_MODE=0\nNEXT_PUBLIC_HUMANOS_DEMO_MODE=0\n'+shared+'HUMANOS_PARTA_LINK_HASH='+hashlib.sha256(token.encode()).hexdigest()+'\n'
for path,content in [(back,backend),(front,frontend)]:
 with path.open('x') as f:f.write(content)
 path.chmod(0o600)
print('Add your model API key to webapp/backend/.env before generating plans.')
print('Private local link: http://localhost:3000/part-a/access/'+token)
