
import asyncio
from app.services.summarization.markdown_converter import MarkdownConverter
from app.services.summarization.pipeline import SummaryPipeline

async def test_conversion():
    conv = MarkdownConverter()
    print("Testing MarkdownConverter.convert_investor_json_to_markdown...")
    investor_json = {
        "company_name": "Test Co",
        "total_share_issue": 1000,
        "section_a_extracted_investors": [
            {"investor_name": "Inv 1", "number_of_equity_shares": 600, "investor_category": "Promoter"}
        ]
    }
    # This matches the pipeline call (1 arg + self)
    res = conv.convert_investor_json_to_markdown(investor_json)
    print("Result starts with:")
    print(res[:100])
    print("Test passed (No TypeError)")

if __name__ == "__main__":
    asyncio.run(test_conversion())
