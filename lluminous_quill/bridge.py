from __future__ import annotations
import json, os, threading, uuid
from pathlib import Path
from typing import Any
from lluminous_quill.core.agent import AgentRunner, RunState
from lluminous_quill.core.skills import SkillRegistry
from lluminous_quill.providers.openai_compatible import OpenAICompatibleProvider, ProviderConfig
from lluminous_quill.security.workspace import Workspace

DEFAULT={"base_url":"https://openrouter.ai/api/v1","model":"","system_prompt":"","ask_before_write":True}

class AppBridge:
    """WebView API. For this prototype, API keys stay in process memory."""
    def __init__(self, data_dir: Path) -> None:
        self.data_dir=data_dir
        self.workspace=Workspace(data_dir/"containers"/"One")
        self.skills=SkillRegistry(data_dir/"skills")
        self.config_path=data_dir/".config"/"providers"/"default.json"
        self.config_path.parent.mkdir(parents=True,exist_ok=True)
        self.lock=threading.RLock(); self.runs={}
        self.config=self._load()
        self.api_key=os.environ.get("LLQUILL_API_KEY","")

    def _load(self) -> dict[str,Any]:
        try:
            obj=json.loads(self.config_path.read_text(encoding="utf-8"))
            if isinstance(obj,dict): return {**DEFAULT,**obj}
        except (OSError,json.JSONDecodeError): pass
        return dict(DEFAULT)

    def get_bootstrap_data(self) -> dict[str,Any]:
        with self.lock: conf=dict(self.config); conf["has_api_key"]=bool(self.api_key)
        return {"app":{"name":"LLuminous Quill","version":"0.1.0"},"provider":conf,
                "workspace":{"name":"One","path":str(self.workspace.root)},"skills":self.skills.list_skills(),
                "capabilities":{"filesystem_tools":True,"command_execution":False}}

    def save_provider_settings(self,settings:dict[str,Any]) -> dict[str,Any]:
        base=str(settings.get("base_url","")).strip().rstrip("/")
        model=str(settings.get("model","")).strip()
        key=str(settings.get("api_key","")).strip()
        if not base.startswith(("https://","http://")): return {"ok":False,"error":"Provider URL must start with http:// or https://."}
        if not model: return {"ok":False,"error":"Enter a model identifier."}
        if "@" in base.split("//",1)[-1].split("/",1)[0]: return {"ok":False,"error":"Credentials are not allowed in the URL."}
        conf={"base_url":base,"model":model,"system_prompt":str(settings.get("system_prompt",""))[:20000],
              "ask_before_write":bool(settings.get("ask_before_write",True))}
        try: self.config_path.write_text(json.dumps(conf,ensure_ascii=False,indent=2),encoding="utf-8")
        except OSError as exc: return {"ok":False,"error":"Could not save settings: "+str(exc)}
        with self.lock:
            self.config=conf
            if key: self.api_key=key
        return {"ok":True,"has_api_key":bool(self.api_key),"message":"Settings saved; API key stays in memory for this session."}

    def start_run(self,user_text:str,history:list[dict[str,str]]|None=None) -> dict[str,Any]:
        user_text=str(user_text).strip()
        if not user_text: return {"ok":False,"error":"Message cannot be empty."}
        with self.lock: conf=dict(self.config); key=self.api_key or os.environ.get("LLQUILL_API_KEY","")
        if not conf.get("model"): return {"ok":False,"error":"Configure a provider and model in Settings first."}
        if not key: return {"ok":False,"error":"No API key. Enter one in Settings or set LLQUILL_API_KEY."}
        run_id=uuid.uuid4().hex[:12]; run=RunState(run_id)
        with self.lock: self.runs[run_id]=run
        provider=OpenAICompatibleProvider(ProviderConfig(str(conf["base_url"]),str(conf["model"]),key))
        runner=AgentRunner(run,self.workspace,self.skills,provider,str(conf.get("system_prompt","")),bool(conf.get("ask_before_write",True)))
        threading.Thread(target=runner.run_turn,args=(user_text,history or []),daemon=True,name="quill-"+run_id).start()
        return {"ok":True,"run_id":run_id}

    def get_run_state(self,run_id:str,after_event_id:int=0) -> dict[str,Any]:
        with self.lock: run=self.runs.get(str(run_id))
        if run is None: return {"ok":False,"error":"Run not found."}
        with run.lock: pending=[{"id":p.id,"tool":p.tool,"arguments":p.args,"summary":p.summary} for p in run.pending.values()]
        return {"ok":True,"run_id":run.id,"status":run.status,"events":run.events.since(int(after_event_id)),"pending":pending}

    def resolve_approval(self,run_id:str,approval_id:str,approved:bool) -> dict[str,Any]:
        with self.lock: run=self.runs.get(str(run_id))
        if run is None: return {"ok":False,"error":"Run not found."}
        ok=run.resolve_approval(str(approval_id),bool(approved))
        return {"ok":ok,"error":None if ok else "Approval request no longer exists."}

    def cancel_run(self,run_id:str) -> dict[str,Any]:
        with self.lock: run=self.runs.get(str(run_id))
        if run is None: return {"ok":False,"error":"Run not found."}
        run.cancel.set()
        with run.lock: ids=list(run.pending)
        for approval_id in ids: run.resolve_approval(approval_id,False)
        return {"ok":True}
