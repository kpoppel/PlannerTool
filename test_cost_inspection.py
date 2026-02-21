#!/usr/bin/env python3
"""
Test script for the new /admin/v1/cost/inspect endpoint.
This script tests the team matching and cost inspection functionality.
"""
import requests
import json

def test_cost_inspection():
    """Test the cost inspection endpoint."""
    url = "http://localhost:8000/admin/v1/cost/inspect"
    
    # Note: This assumes you have admin credentials or the endpoint doesn't require auth for testing
    # In production, you would need to authenticate first
    
    try:
        response = requests.get(url)
        
        print(f"Status Code: {response.status_code}")
        print("\n" + "="*80)
        
        if response.status_code == 200:
            data = response.json()
            
            # Print summary
            summary = data.get('summary', {})
            print("\nSUMMARY:")
            print("-" * 80)
            print(f"Configured Teams (teams.yml):     {summary.get('configured_count', 0)}")
            print(f"Database Teams (database.yml):    {summary.get('database_count', 0)}")
            print(f"Matched Teams:                    {summary.get('matched_count', 0)}")
            print(f"Config-Only Teams:                {summary.get('config_only_count', 0)}")
            print(f"Database-Only Teams:              {summary.get('database_only_count', 0)}")
            print(f"Unmatched People:                 {summary.get('unmatched_people_count', 0)}")
            print(f"\nTotal Internal Cost (monthly):    €{summary.get('total_internal_cost_monthly', 0):,.2f}")
            print(f"Total External Cost (monthly):    €{summary.get('total_external_cost_monthly', 0):,.2f}")
            print(f"Total Cost (monthly):             €{(summary.get('total_internal_cost_monthly', 0) + summary.get('total_external_cost_monthly', 0)):,.2f}")
            
            # Show problematic teams (database-only)
            database_only = data.get('database_only_teams', [])
            if database_only:
                print("\n" + "="*80)
                print("⚠️  TEAMS IN DATABASE BUT NOT IN CONFIG (Won't work for cost calculations):")
                print("-" * 80)
                for team in database_only:
                    print(f"\n  Team: {team['name']}")
                    print(f"  ID:   {team['id']}")
                    print(f"  Members: {team.get('internal_count', 0)} internal, {team.get('external_count', 0)} external")
                    print(f"  Monthly Cost: €{(team.get('internal_cost_total', 0) + team.get('external_cost_total', 0)):,.2f}")
            
            # Show config-only teams
            config_only = data.get('config_only_teams', [])
            if config_only:
                print("\n" + "="*80)
                print("ℹ️  TEAMS IN CONFIG BUT NOT IN DATABASE (No cost data available):")
                print("-" * 80)
                for team in config_only:
                    print(f"  - {team['name']} (ID: {team['id']}, Short: {team.get('short_name', 'N/A')})")
            
            # Show matched teams
            matched = data.get('matched_teams', [])
            if matched:
                print("\n" + "="*80)
                print(f"✓ MATCHED TEAMS ({len(matched)} teams):")
                print("-" * 80)
                for team in matched[:5]:  # Show first 5
                    print(f"\n  Team: {team['name']} (ID: {team['id']})")
                    print(f"  Members: {team.get('internal_count', 0)} internal, {team.get('external_count', 0)} external")
                    print(f"  Monthly Hours: {team.get('internal_hours_total', 0) + team.get('external_hours_total', 0):.0f}h")
                    print(f"  Monthly Cost: €{(team.get('internal_cost_total', 0) + team.get('external_cost_total', 0)):,.2f}")
                if len(matched) > 5:
                    print(f"\n  ... and {len(matched) - 5} more matched teams")
            
            # Show cost config
            cost_cfg = data.get('cost_config', {})
            print("\n" + "="*80)
            print("COST CONFIGURATION:")
            print("-" * 80)
            print(f"Internal Hourly Rate: €{cost_cfg.get('internal_hourly_rate', 0)}")
            print(f"External Default Rate: €{cost_cfg.get('external_hourly_rate_default', 0)}")
            
            print("\n" + "="*80)
            print("\n✓ Test completed successfully!")
            return True
        else:
            print(f"Error: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"Connection error: {e}")
        print("\nMake sure the dev server is running on port 8000")
        print("Run: python3 planner-dev.py")
        return False
    except Exception as e:
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("Testing Cost Inspection Endpoint")
    print("="*80)
    test_cost_inspection()
