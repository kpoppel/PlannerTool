from .config import load_cost_config
from .service import estimate_costs

__all__ = ["load_cost_config", "estimate_costs"]

# Data structure returned from the cost module:
#{
#  "architecture": {
#    "516412": {
#      "internal_cost": 0.0,
#      "internal_hours": 0.0,
#      "external_cost": 0.0,
#      "external_hours": 0.0
#    },
#    ...
#  },
#}
