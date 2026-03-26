
from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List
from app.services.onboarding.agent import onboard_tenant, OnboardingAgent
from app.middleware.internal_auth import require_internal_secret
import logging
import json

router = APIRouter(dependencies=[Depends(require_internal_secret)])
logger = logging.getLogger(__name__)


# Request model for JSON part (toggles)
class OnboardingConfig(BaseModel):
    toggles: Optional[Dict[str, bool]] = {}
    targetInvestors: Optional[List[str]] = []


@router.post("/setup")
async def setup_tenant(
    domainId: str = Form(...),
    config: str = Form(...),
    file: Optional[UploadFile] = File(None),
    sopText: Optional[str] = Form(None), # Accepts raw text from Admin Settings
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Trigger the Onboarding Agent to setup tenant configuration.
    
    This endpoint handles both initial onboarding and re-onboarding.
    It can take a file or raw text (sopText).
    """
    logger.info(f"Received onboarding request for {domainId}")
    
    # Parse the config JSON string manually
    try:
        config_data = OnboardingConfig(**json.loads(config))
    except (json.JSONDecodeError, Exception) as e:
        logger.error(f"Failed to parse config JSON: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid config JSON: {str(e)}")
    
    # Merge targetInvestors into toggles
    toggles = config_data.toggles.copy() if config_data.toggles else {}
    if config_data.targetInvestors:
        toggles["target_investors"] = config_data.targetInvestors
    
    custom_sop_input = ""
    is_raw_text = False
    
    # Process File if Uploaded
    if file:
        logger.info(f"Processing uploaded file: {file.filename}")
        content = await file.read()
        agent = OnboardingAgent()
        extracted_text = agent.extract_text(content, file.filename)
        if extracted_text:
            custom_sop_input = extracted_text
            is_raw_text = True
    elif sopText:
        # If no file but raw text provided, use it
        logger.info(f"Using raw SOP text provided in form for {domainId}")
        custom_sop_input = sopText
        is_raw_text = True

    # Run in background (onboarding can take 30-60s due to LLM calls)
    background_tasks.add_task(
        onboard_tenant, 
        domainId, 
        custom_sop_input,
        is_raw_text,
        toggles
    )
    
    return {
        "status": "processing",
        "message": "Onboarding started in background",
        "domain_id": domainId,
        "has_sop": bool(custom_sop_input),
        "tasks": [
            "Task 1: Subquery refactoring",
            "Task 2: Agent 3 prompt customization",
            "Task 3: Agent 4 prompt customization",
        ] if custom_sop_input else ["Storing toggle configuration only"]
    }


@router.post("/re-onboard")
async def re_onboard_tenant(
    domainId: str = Form(...),
    config: str = Form(...),
    file: Optional[UploadFile] = File(None),
    sopText: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Re-onboarding endpoint. Called when tenant updates their SOP.
    
    This triggers the full onboarding flow again:
      1. Re-analyze updated SOP
      2. Refactor subqueries
      3. Regenerate Agent 3 prompt
      4. Regenerate Agent 4 prompt
      5. Overwrite stored configs in MongoDB
    """
    logger.info(f"Received RE-onboarding request for {domainId}")
    
    # Parse the config JSON string manually
    try:
        config_data = OnboardingConfig(**json.loads(config))
    except (json.JSONDecodeError, Exception) as e:
        logger.error(f"Failed to parse config JSON: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid config JSON: {str(e)}")
    
    # Merge targetInvestors into toggles
    toggles = config_data.toggles.copy() if config_data.toggles else {}
    if config_data.targetInvestors:
        toggles["target_investors"] = config_data.targetInvestors
    
    custom_sop_input = ""
    is_raw_text = False
    
    # Process File or Raw Text
    if file:
        logger.info(f"Processing updated SOP file: {file.filename}")
        content = await file.read()
        agent = OnboardingAgent()
        extracted_text = agent.extract_text(content, file.filename)
        if extracted_text:
            custom_sop_input = extracted_text
            is_raw_text = True
        else:
            raise HTTPException(
                status_code=400,
                detail="Failed to extract text from uploaded SOP file"
            )
    elif sopText:
        logger.info(f"Using raw SOP text provided in form for {domainId}")
        custom_sop_input = sopText
        is_raw_text = True
    else:
        raise HTTPException(
            status_code=400,
            detail="SOP file is required for re-onboarding. Please upload updated SOP."
        )

    # Run in background
    background_tasks.add_task(
        onboard_tenant, 
        domainId, 
        custom_sop_input,
        is_raw_text,
        toggles
    )
    
    return {
        "status": "processing",
        "message": "Re-onboarding started. Pipeline configs will be updated.",
        "domain_id": domainId,
        "tasks": [
            "Task 1: Subquery re-analysis",
            "Task 2: Agent 3 prompt regeneration",
            "Task 3: Agent 4 prompt regeneration",
            "Task 4: MongoDB config overwrite",
        ]
    }


@router.get("/status/{domain_id}")
async def get_onboarding_status(domain_id: str):
    """
    Get the current onboarding status and configuration for a tenant.
    Returns the stored SOP analysis, custom prompts, and toggle settings.
    """
    try:
        agent = OnboardingAgent()
        config = agent.collection.find_one({"domainId": domain_id})
        
        if not config:
            return {
                "status": "not_found",
                "message": f"No configuration found for domain {domain_id}",
                "onboarding_required": True
            }
        
        # Remove MongoDB _id and large prompt texts for status endpoint
        if "_id" in config:
            del config["_id"]
        
        return {
            "status": "found",
            "domain_id": domain_id,
            "onboarding_status": config.get("onboarding_status", "unknown"),
            "last_onboarded": config.get("last_onboarded"),
            "has_sop": bool(config.get("sop_text")),
            "has_custom_subqueries": bool(config.get("custom_subqueries")),
            "custom_subqueries_count": len(config.get("custom_subqueries", [])),
            "has_agent3_prompt": bool(config.get("agent3_prompt")),
            "has_agent4_prompt": bool(config.get("agent4_prompt")),
            "toggles": {
                "investor_match_only": config.get("investor_match_only", False),
                "valuation_matching": config.get("valuation_matching", False),
                "adverse_finding": config.get("adverse_finding", False),
            },
            "target_investors": config.get("target_investors", []),
            "subquery_analysis": config.get("subquery_analysis", {}),
        }
    except Exception as e:
        logger.error(f"Failed to get onboarding status: {e}")
        raise HTTPException(status_code=500, detail=str(e))
