"""
Abuse protection — re-exports from shared config.
Streamlit (archived) uses this module.
"""
from config.abuse import check_input_size, check_rate_limit, check_session_budget

__all__ = ["check_input_size", "check_rate_limit", "check_session_budget"]
